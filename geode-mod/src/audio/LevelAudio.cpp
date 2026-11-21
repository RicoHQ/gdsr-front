#include "LevelAudio.hpp"
#include "../Config.hpp"

#include <Geode/binding/MusicDownloadManager.hpp>
#include <Geode/binding/SongInfoObject.hpp>
#include <Geode/binding/LevelTools.hpp>
#include <Geode/binding/FMODAudioEngine.hpp>
#include <fmod.hpp>
#include <Geode/utils/file.hpp>
#include <matjson.hpp>
#include <filesystem>
#include <cctype>

using namespace geode::prelude;

namespace gdsr {

static std::filesystem::path toPath(std::string const& s) {
    return std::filesystem::path(std::u8string(reinterpret_cast<char8_t const*>(s.data()), s.size()));
}

static std::string fromPath(std::filesystem::path const& p) {
    auto u8 = p.u8string();
    return std::string(reinterpret_cast<char const*>(u8.data()), u8.size());
}

static bool fileExists(std::string const& path) {
    std::error_code ec;
    return std::filesystem::exists(toPath(path), ec);
}

static unsigned long fileSize(std::string const& path) {
    std::error_code ec;
    auto size = std::filesystem::file_size(toPath(path), ec);
    return ec ? 0 : static_cast<unsigned long>(size);
}

static std::string baseName(std::string const& path) {
    auto pos = path.find_last_of("/\\");
    return pos == std::string::npos ? path : path.substr(pos + 1);
}

// Jukebox: one manifest per song ID in <save dir>/manifest/<id>.json.
// RobTop tracks use -(track + 1).
static std::optional<AudioInfo> jukeboxAudio(int manifestID, int songID) {
    auto jukebox = Loader::get()->getLoadedMod("fleym.nongd");
    if (!jukebox) return std::nullopt;

    auto saveDir = jukebox->getSaveDir();
    auto manifestPath = saveDir / "manifest" / fmt::format("{}.json", manifestID);
    std::error_code ec;
    if (!std::filesystem::exists(manifestPath, ec)) return std::nullopt;

    auto text = file::readString(manifestPath);
    if (!text) return std::nullopt;
    auto parsed = matjson::parse(text.unwrap());
    if (!parsed) return std::nullopt;
    auto const manifest = parsed.unwrap();

    auto active = manifest["active"].asString().unwrapOr("");
    if (active.empty()) return std::nullopt;
    if (manifest["default"]["unique_id"].asString().unwrapOr("") == active) return std::nullopt;

    for (auto list : {"locals", "youtube", "hosted"}) {
        auto const& arr = manifest[list];
        if (!arr.isArray()) continue;
        for (auto const& entry : arr) {
            if (entry["unique_id"].asString().unwrapOr("") != active) continue;

            std::string path;
            if (entry["path"].isString()) path = entry["path"].asString().unwrap();
            if ((path.empty() || !fileExists(path)) && entry["filename"].isString()) {
                path = fromPath(saveDir / "nongs" / toPath(entry["filename"].asString().unwrap()));
            }

            AudioInfo info;
            info.origin = AudioOrigin::Jukebox;
            info.songID = songID;
            info.name = entry["name"].asString().unwrapOr("");
            info.artist = entry["artist"].asString().unwrapOr("");
            info.path = path;
            info.fileName = baseName(path);
            if (!path.empty() && fileExists(path)) {
                info.readable = true;
                info.size = fileSize(path);
            } else {
                info.problem = "The Jukebox song isn't downloaded yet.";
            }
            return info;
        }
    }
    return std::nullopt;
}

AudioInfo findLevelAudio(GJGameLevel* level) {
    AudioInfo info;
    if (!level) { info.problem = "No level."; return info; }

    bool useJukebox = Mod::get()->getSettingValue<bool>("use-jukebox");
    int songID = level->m_songID;

    // official (RobTop) tracks
    if (songID <= 0) {
        int track = level->m_audioTrack;
        if (useJukebox) {
            if (auto nong = jukeboxAudio(-track - 1, 0)) return *nong;
        }
        info.origin = AudioOrigin::Official;
        info.songID = 0;
        info.name = std::string(LevelTools::getAudioTitle(track));
        info.artist = std::string(LevelTools::nameForArtist(LevelTools::artistForAudio(track)));
        info.fileName = std::string(LevelTools::getAudioFileName(track));
        info.path = std::string(CCFileUtils::sharedFileUtils()->fullPathForFilename(info.fileName.c_str(), false));
        info.readable = CCFileUtils::sharedFileUtils()->isFileExist(info.path);
        if (!info.readable) info.problem = "Couldn't find this official song in the game files.";
        return info;
    }

    if (useJukebox) {
        if (auto nong = jukeboxAudio(songID, songID)) return *nong;
    }

    auto mdm = MusicDownloadManager::sharedState();
    info.origin = songID >= 10000000 ? AudioOrigin::Library : AudioOrigin::Newgrounds;
    info.songID = songID;
    if (auto obj = mdm->getSongInfoObject(songID)) {
        info.name = std::string(obj->m_songName);
        info.artist = std::string(obj->m_artistName);
    }
    info.path = std::string(mdm->pathForSong(songID));
    info.fileName = baseName(info.path);
    if (mdm->isSongDownloaded(songID) && fileExists(info.path)) {
        info.readable = true;
        info.size = fileSize(info.path);
    } else {
        info.problem = "Download the song in-game first (press the download button on the song).";
    }
    return info;
}

Result<ByteVector> readAudio(AudioInfo const& info) {
    if (!info.readable) return Err(info.problem.empty() ? std::string("No audio file.") : info.problem);
    if (fileExists(info.path)) {
        auto data = file::readBinary(toPath(info.path));
        if (!data) return Err(fmt::format("Couldn't read {}: {}", info.fileName, data.unwrapErr()));
        return Ok(data.unwrap());
    }
    // APK assets on Android (official tracks)
    unsigned long size = 0;
    unsigned char* raw = CCFileUtils::sharedFileUtils()->getFileData(info.path.c_str(), "rb", &size);
    if (!raw || size == 0) {
        if (raw) delete[] raw;
        return Err(fmt::format("Couldn't read {}.", info.fileName));
    }
    ByteVector out(raw, raw + size);
    delete[] raw;
    return Ok(std::move(out));
}

unsigned int audioDurationSeconds(ByteVector const& data) {
    auto engine = FMODAudioEngine::sharedEngine();
    if (!engine || !engine->m_system || data.empty()) return 0;
    FMOD_CREATESOUNDEXINFO ex{};
    ex.cbsize = sizeof(ex);
    ex.length = static_cast<unsigned int>(data.size());
    FMOD::Sound* sound = nullptr;
    auto r = engine->m_system->createSound(
        reinterpret_cast<char const*>(data.data()),
        FMOD_OPENMEMORY_POINT | FMOD_CREATESTREAM | FMOD_OPENONLY, &ex, &sound
    );
    if (r != FMOD_OK || !sound) return 0;
    unsigned int ms = 0;
    sound->getLength(&ms, FMOD_TIMEUNIT_MS);
    sound->release();
    return (ms + 500) / 1000;
}

std::string mimeFor(std::string const& fileName) {
    auto lower = utils::string::toLower(fileName);
    if (lower.ends_with(".ogg") || lower.ends_with(".oga")) return "audio/ogg";
    if (lower.ends_with(".wav")) return "audio/wav";
    if (lower.ends_with(".m4a") || lower.ends_with(".mp4")) return "audio/mp4";
    if (lower.ends_with(".flac")) return "audio/flac";
    if (lower.ends_with(".opus")) return "audio/opus";
    return "audio/mpeg";
}

std::string originLabel(AudioOrigin origin) {
    switch (origin) {
        case AudioOrigin::Official: return "Official song";
        case AudioOrigin::Newgrounds: return "Newgrounds song";
        case AudioOrigin::Library: return "Music library song";
        case AudioOrigin::Jukebox: return "Jukebox song";
        default: return "No song";
    }
}

std::string formatBytes(unsigned long bytes) {
    if (bytes >= 1024ul * 1024ul) return fmt::format("{:.1f} MB", bytes / (1024.0 * 1024.0));
    if (bytes >= 1024ul) return fmt::format("{} KB", bytes / 1024ul);
    return fmt::format("{} B", bytes);
}

}
