#include "AfkAdmin.hpp"
#include "../audio/LevelAudio.hpp"
#include "../Config.hpp"

#include <Geode/utils/file.hpp>
#include <chrono>
#include <cctype>
#include <set>

using namespace geode::prelude;

namespace gdsr {

static std::string idList(std::set<long long> const& ids) {
    std::string out;
    for (auto id : ids) { if (!out.empty()) out += ","; out += std::to_string(id); }
    return out;
}

arc::Future<Result<AfkPage>> afkFetchPage(GDSearch search, int page, bool wantLevels, bool wantSongs) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    if (!session().isAdmin) co_return Err("AFK Admin is only for admins.");

    auto fetched = co_await fetchLevels(std::move(search), page);
    if (!fetched) co_return Err(fetched.unwrapErr());
    auto levels = std::move(fetched).unwrap();

    AfkPage out;
    out.page = page;
    out.checked = static_cast<int>(levels.size());
    auto jobs = co_await afkJobsFor(std::move(levels), wantLevels, wantSongs, {});
    if (!jobs) co_return Err(jobs.unwrapErr());
    out.jobs = std::move(jobs).unwrap();
    co_return Ok(std::move(out));
}

arc::Future<Result<std::vector<AfkJob>>> afkJobsFor(std::vector<GDLevel> levels, bool wantLevels, bool wantSongs, std::set<long long> queued) {
    std::set<long long> levelIDs, songIDs, haveLevels, haveSongs;
    for (auto const& l : levels) { levelIDs.insert(l.levelID); if (l.songID) songIDs.insert(l.songID); }
    // one request each for every level and song on the page
    if (wantLevels && !levelIDs.empty()) {
        auto have = co_await rest("GET", "levels?select=level_id&level_id=in.(" + idList(levelIDs) + ")");
        if (!have) co_return Err(have.unwrapErr());
        auto rows = have.unwrap();
        if (rows.isArray()) for (auto const& r : rows) if (r["level_id"].isNumber()) haveLevels.insert(static_cast<long long>(r["level_id"].asDouble().unwrapOr(0)));
    }
    if (wantSongs && !songIDs.empty()) {
        auto have = co_await rest("GET", "songs?select=song_id&song_id=in.(" + idList(songIDs) + ")");
        if (!have) co_return Err(have.unwrapErr());
        auto rows = have.unwrap();
        if (rows.isArray()) for (auto const& r : rows) if (r["song_id"].isNumber()) haveSongs.insert(static_cast<long long>(r["song_id"].asDouble().unwrapOr(0)));
    }

    std::vector<AfkJob> jobs;
    for (auto& l : levels) {
        AfkJob job;
        job.addLevel = wantLevels && !haveLevels.contains(l.levelID);
        // two levels can share a song
        job.addSong = wantSongs && l.songID && !haveSongs.contains(l.songID) && !queued.contains(l.songID);
        if (job.addSong) queued.insert(l.songID);
        if (!job.addLevel && !job.addSong) continue;
        job.level = std::move(l);
        jobs.push_back(std::move(job));
    }
    co_return Ok(std::move(jobs));
}

static Json orNull(std::string const& s) { return s.empty() ? Json(nullptr) : Json(s); }

static std::string safeName(std::string const& s) {
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_') out += static_cast<char>(c);
        else if (!out.empty() && out.back() != '-') out += '-';
    }
    if (out.size() > 40) out = out.substr(0, 40);
    return out.empty() ? "song" : out;
}

static std::string extFromUrl(std::string const& url) {
    auto q = url.find('?');
    auto path = url.substr(0, q);
    auto dot = path.find_last_of('.');
    if (dot == std::string::npos) return ".mp3";
    auto ext = utils::string::toLower(path.substr(dot));
    if (ext == ".mp3" || ext == ".ogg" || ext == ".wav" || ext == ".m4a") return ext;
    return ".mp3";
}

arc::Future<Result<AfkResult>> afkImport(AfkJob job) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    auto const& l = job.level;
    AfkResult out;
    Json songIdValue = l.songID ? Json(static_cast<std::intmax_t>(l.songID)) : Json(nullptr);

    if (l.songID) {
        auto ids = co_await rest("POST", "song_ids?on_conflict=song_id", matjson::makeObject({ {"song_id", songIdValue} }), "resolution=ignore-duplicates,return=minimal");
        if (!ids) co_return Err("Song ID: " + ids.unwrapErr());
    }

    std::vector<std::string> notes;
    if (job.addLevel) {
        auto row = matjson::makeObject({
            {"name", l.name},
            {"level_id", Json(static_cast<std::intmax_t>(l.levelID))},
            {"creators", orNull(l.creator)},
            {"verifier", Json(nullptr)},
            {"length", orNull(l.length)},
            {"difficulty", orNull(l.difficulty)},
            {"stars", Json(static_cast<std::intmax_t>(l.stars))},
            {"song_id", songIdValue},
        });
        auto res = co_await rest("POST", "levels", row, "return=minimal");
        if (!res) notes.push_back("level failed: " + res.unwrapErr());
        else { out.levelAdded = true; notes.push_back("level added"); }
    }

    if (job.addSong) {
        ByteVector audio;
        std::string ext = ".mp3";
        if (!job.localPath.empty()) {
            auto data = file::readBinary(std::filesystem::path(job.localPath));
            if (data) { audio = std::move(data).unwrap(); ext = extFromUrl(job.localPath); }
        }
        if (audio.empty() && !l.songUrl.empty()) {
            web::WebRequest get;
            get.timeout(std::chrono::seconds(120));
            auto res = co_await get.get(l.songUrl);
            if (res.ok()) { audio = std::move(res).data(); ext = extFromUrl(l.songUrl); }
        }
        if (audio.empty()) notes.push_back("song skipped (no download available)");
        else if (audio.size() > MAX_AUDIO_BYTES) notes.push_back("song skipped (over 20 MB)");
        else {
            auto secs = audioDurationSeconds(audio);
            auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            auto path = fmt::format("{}/songs/{}-{}-{}{}", session().userId, ms, l.songID, safeName(l.songName), ext);
            auto up = co_await uploadAudio(path, std::move(audio), mimeFor("a" + ext));
            if (!up) notes.push_back("song upload failed: " + up.unwrapErr());
            else {
                auto row = matjson::makeObject({
                    {"song_id", songIdValue},
                    {"name", l.songName.empty() ? fmt::format("Song {}", l.songID) : l.songName},
                    {"type", "original"},
                    {"author", orNull(l.songArtist)},
                    {"length", secs ? Json(fmt::format("{}:{:02}", secs / 60, secs % 60)) : Json(nullptr)},
                    {"audio_file", up.unwrap()},
                });
                auto res = co_await rest("POST", "songs", row, "return=minimal");
                if (!res) notes.push_back("song failed: " + res.unwrapErr());
                else { out.songAdded = true; notes.push_back("song added"); }
            }
        }
    }

    std::string joined;
    for (auto const& n : notes) { if (!joined.empty()) joined += ", "; joined += n; }
    out.message = fmt::format("{}: {}", l.name, joined);
    co_return Ok(std::move(out));
}

}
