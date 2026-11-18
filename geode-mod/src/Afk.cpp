#include "Afk.hpp"
#include "AudioSource.hpp"
#include "Config.hpp"

#include <Geode/utils/file.hpp>
#include <chrono>
#include <cctype>
#include <set>

using namespace geode::prelude;

namespace gdsr {

// ---------------------------------------------------------------- GD server response

static std::vector<std::string> split(std::string const& s, std::string const& sep) {
    std::vector<std::string> out;
    size_t start = 0;
    while (true) {
        auto pos = s.find(sep, start);
        out.push_back(s.substr(start, pos == std::string::npos ? std::string::npos : pos - start));
        if (pos == std::string::npos) break;
        start = pos + sep.size();
    }
    return out;
}

// "k:v:k:v" (or with another separator) into a map
static std::map<std::string, std::string> pairs(std::string const& s, std::string const& sep) {
    std::map<std::string, std::string> out;
    auto parts = split(s, sep);
    for (size_t i = 0; i + 1 < parts.size(); i += 2) out[parts[i]] = parts[i + 1];
    return out;
}

static long long num(std::map<std::string, std::string> const& m, std::string const& key) {
    auto it = m.find(key);
    if (it == m.end() || it->second.empty()) return 0;
    char* end = nullptr;
    auto v = std::strtoll(it->second.c_str(), &end, 10);
    return end == it->second.c_str() ? 0 : v;
}

static std::string str(std::map<std::string, std::string> const& m, std::string const& key) {
    auto it = m.find(key);
    return it == m.end() ? "" : it->second;
}

static std::string urlDecode(std::string const& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size() && std::isxdigit(static_cast<unsigned char>(s[i + 1])) && std::isxdigit(static_cast<unsigned char>(s[i + 2]))) {
            out += static_cast<char>(std::stoi(s.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else if (s[i] == '+') out += ' ';
        else out += s[i];
    }
    return out;
}

static std::string difficultyName(std::map<std::string, std::string> const& m) {
    if (num(m, "25") == 1) return "Auto";
    if (num(m, "17") == 1) {
        switch (num(m, "43")) {
            case 3: return "Easy Demon";
            case 4: return "Medium Demon";
            case 5: return "Insane Demon";
            case 6: return "Extreme Demon";
            default: return "Hard Demon";
        }
    }
    switch (num(m, "9") / 10) {
        case 1: return "Easy";
        case 2: return "Normal";
        case 3: return "Hard";
        case 4: return "Harder";
        case 5: return "Insane";
        default: return "";
    }
}

static std::string lengthName(long long len) {
    static char const* names[] = { "Tiny", "Short", "Medium", "Long", "XL", "Platformer" };
    return len >= 0 && len <= 5 ? names[len] : "";
}

static Result<std::vector<GDLevel>> parseLevels(std::string const& body) {
    if (body.empty() || body == "-1") return Err("The Geometry Dash servers returned no levels.");
    auto sections = split(body, "#");
    std::map<long long, std::string> creators;
    if (sections.size() > 1) {
        for (auto const& c : split(sections[1], "|")) {
            auto p = split(c, ":");
            if (p.size() >= 2) creators[std::strtoll(p[0].c_str(), nullptr, 10)] = p[1];
        }
    }
    std::map<long long, std::map<std::string, std::string>> songs;
    if (sections.size() > 2 && !sections[2].empty()) {
        for (auto const& s : split(sections[2], "~:~")) {
            auto m = pairs(s, "~|~");
            if (auto id = num(m, "1")) songs[id] = m;
        }
    }
    std::vector<GDLevel> out;
    for (auto const& entry : split(sections[0], "|")) {
        if (entry.empty()) continue;
        auto m = pairs(entry, ":");
        GDLevel l;
        l.levelID = num(m, "1");
        if (!l.levelID) continue;
        l.name = str(m, "2");
        l.creator = creators.contains(num(m, "6")) ? creators[num(m, "6")] : "";
        l.difficulty = difficultyName(m);
        l.length = lengthName(num(m, "15"));
        l.stars = static_cast<int>(num(m, "18"));
        l.downloads = num(m, "10");
        l.songID = num(m, "35");
        if (l.songID && songs.contains(l.songID)) {
            auto const& s = songs[l.songID];
            l.songName = str(s, "2");
            l.songArtist = str(s, "4");
            l.songUrl = urlDecode(str(s, "10"));
        }
        out.push_back(std::move(l));
    }
    return Ok(std::move(out));
}

static std::string idList(std::set<long long> const& ids) {
    std::string out;
    for (auto id : ids) { if (!out.empty()) out += ","; out += std::to_string(id); }
    return out;
}

arc::Future<Result<AfkPage>> afkFetchPage(int page, bool wantLevels, bool wantSongs) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    if (!session().isAdmin) co_return Err("AFK Admin is only for admins.");

    web::WebRequest req;
    req.userAgent("");
    req.header("Content-Type", "application/x-www-form-urlencoded");
    req.header("Accept", "*/*");
    req.bodyString(fmt::format("gameVersion=22&binaryVersion=45&type=1&str=&diff=-&len=-&page={}&total=0&secret=Wmfd2893gb7", page));
    req.timeout(std::chrono::seconds(30));
    auto res = co_await req.post("https://www.boomlings.com/database/getGJLevels21.php");
    if (!res.ok()) co_return Err(fmt::format("Geometry Dash servers: error {}", res.code()));
    auto parsed = parseLevels(res.string().unwrapOr(""));
    if (!parsed) co_return Err(parsed.unwrapErr());
    auto levels = std::move(parsed).unwrap();

    AfkPage out;
    out.page = page;
    out.checked = static_cast<int>(levels.size());

    std::set<long long> levelIDs, songIDs, haveLevels, haveSongs;
    for (auto const& l : levels) { levelIDs.insert(l.levelID); if (l.songID) songIDs.insert(l.songID); }
    if (!levelIDs.empty()) {
        auto have = co_await rest("GET", "levels?select=level_id&level_id=in.(" + idList(levelIDs) + ")");
        if (!have) co_return Err(have.unwrapErr());
        auto rows = have.unwrap();
        if (rows.isArray()) for (auto const& r : rows) if (r["level_id"].isNumber()) haveLevels.insert(static_cast<long long>(r["level_id"].asDouble().unwrapOr(0)));
    }
    if (!songIDs.empty()) {
        auto have = co_await rest("GET", "songs?select=song_id&song_id=in.(" + idList(songIDs) + ")");
        if (!have) co_return Err(have.unwrapErr());
        auto rows = have.unwrap();
        if (rows.isArray()) for (auto const& r : rows) if (r["song_id"].isNumber()) haveSongs.insert(static_cast<long long>(r["song_id"].asDouble().unwrapOr(0)));
    }

    std::set<long long> songsQueued;   // two levels on one page can share a song
    for (auto& l : levels) {
        AfkJob job;
        job.addLevel = wantLevels && !haveLevels.contains(l.levelID);
        job.addSong = wantSongs && l.songID && !haveSongs.contains(l.songID) && !songsQueued.contains(l.songID);
        if (job.addSong) songsQueued.insert(l.songID);
        if (!job.addLevel && !job.addSong) continue;
        job.level = std::move(l);
        out.jobs.push_back(std::move(job));
    }
    co_return Ok(std::move(out));
}

// ---------------------------------------------------------------- import

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
