#include "JukeboxSync.hpp"
#include "../net/Supabase.hpp"
#include "../audio/LevelAudio.hpp"
#include "../Config.hpp"

#include <Geode/utils/file.hpp>
#include <Geode/utils/async.hpp>
#include <Geode/ui/Notification.hpp>
#include <matjson.hpp>
#include <filesystem>
#include <chrono>
#include <cctype>
#include <set>
#include <map>
#include <memory>

using namespace geode::prelude;

namespace gdsr {

static std::filesystem::path toPath(std::string const& s) {
    return std::filesystem::path(std::u8string(reinterpret_cast<char8_t const*>(s.data()), s.size()));
}

static std::string fromPath(std::filesystem::path const& p) {
    auto u8 = p.u8string();
    return std::string(reinterpret_cast<char const*>(u8.data()), u8.size());
}

static bool exists(std::string const& path) {
    std::error_code ec;
    return !path.empty() && std::filesystem::exists(toPath(path), ec);
}

static std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::vector<JukeboxSong> jukeboxSongs(int songID) {
    std::vector<JukeboxSong> out;
    auto jukebox = Loader::get()->getLoadedMod("fleym.nongd");
    if (!jukebox || songID <= 0) return out;

    auto saveDir = jukebox->getSaveDir();
    auto text = file::readString(saveDir / "manifest" / fmt::format("{}.json", songID));
    if (!text) return out;
    auto parsed = matjson::parse(text.unwrap());
    if (!parsed) return out;
    auto const manifest = parsed.unwrap();
    auto original = manifest["default"]["unique_id"].asString().unwrapOr("");

    for (auto list : {"locals", "hosted", "youtube"}) {
        auto const& arr = manifest[list];
        if (!arr.isArray()) continue;
        for (auto const& entry : arr) {
            JukeboxSong song;
            song.uniqueID = entry["unique_id"].asString().unwrapOr("");
            if (!original.empty() && song.uniqueID == original) continue;
            song.name = entry["name"].asString().unwrapOr("");
            song.artist = entry["artist"].asString().unwrapOr("");
            if (entry["path"].isString()) song.path = entry["path"].asString().unwrap();
            if (!exists(song.path) && entry["filename"].isString())
                song.path = fromPath(saveDir / "nongs" / toPath(entry["filename"].asString().unwrap()));
            if (!exists(song.path)) song.path.clear();
            if (entry["url"].isString()) song.url = entry["url"].asString().unwrap();
            if (song.name.empty() || (song.path.empty() && song.url.empty())) continue;
            out.push_back(std::move(song));
        }
    }
    return out;
}

struct SyncResult { int added = 0; int skipped = 0; std::vector<std::string> problems; };

static std::string extOf(std::string const& s) {
    auto path = s.substr(0, s.find('?'));
    auto dot = path.find_last_of('.');
    if (dot == std::string::npos) return ".mp3";
    auto ext = lower(path.substr(dot));
    return (ext == ".mp3" || ext == ".ogg" || ext == ".wav" || ext == ".m4a" || ext == ".flac" || ext == ".opus") ? ext : ".mp3";
}

static std::string slug(std::string const& s) {
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c)) out += static_cast<char>(c);
        else if (!out.empty() && out.back() != '-') out += '-';
    }
    if (out.size() > 40) out.resize(40);
    return out.empty() ? "nong" : out;
}

static arc::Future<Result<SyncResult>> runSync(int songID, std::vector<JukeboxSong> songs) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    if (!session().isAdmin) co_return Err("Only admins add Jukebox songs.");

    // names already on this song ID, so nothing is added twice
    std::set<std::string> have;
    auto existing = co_await rest("GET", fmt::format("songs?select=name&song_id=eq.{}", songID));
    if (!existing) co_return Err(existing.unwrapErr());
    auto rows = existing.unwrap();
    if (rows.isArray()) for (auto const& r : rows) have.insert(lower(r["name"].asString().unwrapOr("")));

    SyncResult out;
    std::vector<JukeboxSong> todo;
    for (auto& s : songs) {
        if (have.contains(lower(s.name))) { out.skipped++; continue; }
        have.insert(lower(s.name));
        todo.push_back(std::move(s));
    }
    if (todo.empty()) co_return Ok(std::move(out));

    auto ids = co_await rest("POST", "song_ids?on_conflict=song_id", matjson::makeObject({ {"song_id", static_cast<std::intmax_t>(songID)} }), "resolution=ignore-duplicates,return=minimal");
    if (!ids) co_return Err("Song ID: " + ids.unwrapErr());

    for (auto const& s : todo) {
        ByteVector audio;
        std::string ext = ".mp3";
        if (!s.path.empty()) {
            auto data = file::readBinary(toPath(s.path));
            if (data) { audio = std::move(data).unwrap(); ext = extOf(s.path); }
        }
        if (audio.empty() && !s.url.empty()) {
            web::WebRequest get;
            get.timeout(std::chrono::seconds(120));
            auto res = co_await get.get(s.url);
            if (res.ok()) { audio = std::move(res).data(); ext = extOf(s.url); }
        }
        if (audio.empty()) { out.problems.push_back(s.name + ": not downloaded in Jukebox"); continue; }
        if (audio.size() > MAX_AUDIO_BYTES) { out.problems.push_back(s.name + ": over 20 MB"); continue; }

        auto secs = audioDurationSeconds(audio);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        auto path = fmt::format("{}/songs/{}-{}-{}{}", session().userId, ms, songID, slug(s.name), ext);
        auto up = co_await uploadAudio(path, std::move(audio), mimeFor("a" + ext));
        if (!up) { out.problems.push_back(s.name + ": " + up.unwrapErr()); continue; }

        auto row = matjson::makeObject({
            {"song_id", static_cast<std::intmax_t>(songID)},
            {"name", s.name},
            {"type", "nong"},
            {"author", s.artist.empty() ? Json(nullptr) : Json(s.artist)},
            {"length", secs ? Json(fmt::format("{}:{:02}", secs / 60, secs % 60)) : Json(nullptr)},
            {"audio_file", up.unwrap()},
        });
        auto res = co_await rest("POST", "songs", row, "return=minimal");
        if (!res) out.problems.push_back(s.name + ": " + res.unwrapErr());
        else out.added++;
    }
    co_return Ok(std::move(out));
}

void syncJukeboxSongs(int songID) {
    if (!signedIn() || !session().isAdmin) return;
    if (!Mod::get()->getSettingValue<bool>("auto-jukebox")) return;
    auto songs = jukeboxSongs(songID);
    if (songs.empty()) return;

    // each Jukebox song is sent once per game session
    static std::set<std::string> sent;
    static std::set<int> running;
    if (running.contains(songID)) return;
    std::vector<JukeboxSong> fresh;
    std::vector<std::string> keys;
    for (auto& s : songs) {
        auto key = fmt::format("{}:{}", songID, s.uniqueID);
        if (sent.contains(key)) continue;
        keys.push_back(key);
        fresh.push_back(std::move(s));
    }
    if (fresh.empty()) return;
    for (auto const& k : keys) sent.insert(k);
    running.insert(songID);

    // outlives the popup, so closing GDSR doesn't stop it
    static std::map<int, std::unique_ptr<geode::async::TaskHolder<Result<SyncResult>>>> tasks;
    auto& holder = tasks[songID];
    holder = std::make_unique<geode::async::TaskHolder<Result<SyncResult>>>();
    holder->spawn(runSync(songID, std::move(fresh)), [songID, keys](Result<SyncResult> res) {
        running.erase(songID);
        if (!res) {
            // try again next time GDSR is opened on this level
            for (auto const& k : keys) sent.erase(k);
            Notification::create("GDSR Jukebox: " + res.unwrapErr(), NotificationIcon::Error, 3.f)->show();
            return;
        }
        auto r = res.unwrap();
        if (!r.added && r.problems.empty()) return;
        std::string text = r.added ? fmt::format("GDSR: added {} Jukebox song{} for song {}", r.added, r.added == 1 ? "" : "s", songID)
                                   : fmt::format("GDSR: couldn't add Jukebox songs for song {}", songID);
        if (!r.problems.empty()) text += fmt::format(" ({} failed: {})", r.problems.size(), r.problems.front());
        Notification::create(text, r.added ? NotificationIcon::Success : NotificationIcon::Warning, 3.f)->show();
        log::info("Jukebox sync for {}: {} added, {} skipped, {} failed", songID, r.added, r.skipped, r.problems.size());
    });
}

}
