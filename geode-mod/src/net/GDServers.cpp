#include "GDServers.hpp"

#include <cctype>
#include <chrono>
#include <map>
#include <algorithm>

using namespace geode::prelude;

namespace gdsr {

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

static std::string urlEncode(std::string const& s) {
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += static_cast<char>(c);
        else out += fmt::format("%{:02X}", c);
    }
    return out;
}

static web::WebRequest boomlings(std::string body) {
    web::WebRequest req;
    // the servers reject requests that send a user agent
    req.userAgent("");
    req.header("Content-Type", "application/x-www-form-urlencoded");
    req.header("Accept", "*/*");
    req.bodyString(std::move(body));
    req.timeout(std::chrono::seconds(30));
    return req;
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
    if (body.empty()) return Err("The Geometry Dash servers sent an empty reply.");
    if (body == "-1") return Ok(std::vector<GDLevel>{});
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

std::vector<GDSearchType> const& searchTypes() {
    static std::vector<GDSearchType> const types = {
        { 1, "Most downloaded" }, { 2, "Most liked" }, { 3, "Trending" }, { 4, "Recent" },
        { 6, "Featured" }, { 7, "Magic" }, { 11, "Awarded" }, { 16, "Hall of Fame" },
    };
    return types;
}

static std::string joined(std::vector<int> const& v) {
    std::string out;
    for (auto x : v) { if (!out.empty()) out += ","; out += std::to_string(x); }
    return out;
}

static std::vector<int> intList(matjson::Value const& v) {
    std::vector<int> out;
    if (v.isArray()) for (auto const& x : v) if (x.isNumber()) out.push_back(static_cast<int>(x.asInt().unwrapOr(0)));
    return out;
}

matjson::Value GDSearch::toJson() const {
    auto d = matjson::Value::array(), l = matjson::Value::array();
    for (auto x : diffs) d.push(x);
    for (auto x : lengths) l.push(x);
    return matjson::makeObject({ {"type", type}, {"diffs", d}, {"demon", demon}, {"lengths", l}, {"starred", starred} });
}

GDSearch GDSearch::fromJson(matjson::Value const& v) {
    GDSearch s;
    if (!v.isObject()) return s;
    s.type = static_cast<int>(v["type"].asInt().unwrapOr(1));
    bool known = false;
    for (auto const& t : searchTypes()) known |= t.id == s.type;
    if (!known) s.type = 1;
    s.diffs = intList(v["diffs"]);
    s.demon = static_cast<int>(v["demon"].asInt().unwrapOr(0));
    s.lengths = intList(v["lengths"]);
    s.starred = v["starred"].asBool().unwrapOr(false);
    return s;
}

std::string GDSearch::summary() const {
    std::string out;
    for (auto const& t : searchTypes()) if (t.id == type) out = t.name;
    static std::map<int, char const*> const diffNames = { {-1, "N/A"}, {-3, "Auto"}, {1, "Easy"}, {2, "Normal"}, {3, "Hard"}, {4, "Harder"}, {5, "Insane"}, {-2, "Demon"} };
    static char const* demonNames[] = { "", "Easy", "Medium", "Hard", "Insane", "Extreme" };
    static char const* lenNames[] = { "Tiny", "Short", "Medium", "Long", "XL", "Plat." };
    if (!diffs.empty()) {
        std::string d;
        for (auto x : diffs) { if (!d.empty()) d += ", "; d += diffNames.contains(x) ? diffNames.at(x) : "?"; }
        if (diffs.size() == 1 && diffs[0] == -2 && demon >= 1 && demon <= 5) d = std::string(demonNames[demon]) + " Demon";
        out += " · " + d;
    }
    if (!lengths.empty()) {
        std::string l;
        for (auto x : lengths) if (x >= 0 && x <= 5) { if (!l.empty()) l += ", "; l += lenNames[x]; }
        out += " · " + l;
    }
    if (starred) out += " · Rated";
    return out;
}

arc::Future<Result<std::vector<GDLevel>>> fetchLevels(GDSearch search, int page) {
    std::string body = fmt::format("gameVersion=22&binaryVersion=45&type={}&str={}&diff={}&len={}&page={}&total=0&secret=Wmfd2893gb7",
        search.type, urlEncode(search.query), search.diffs.empty() ? "-" : joined(search.diffs), search.lengths.empty() ? "-" : joined(search.lengths), page);
    if (search.song > 0) body += fmt::format("&song={}&customSong=1", search.song);
    if (search.diffs.size() == 1 && search.diffs[0] == -2 && search.demon >= 1 && search.demon <= 5)
        body += fmt::format("&demonFilter={}", search.demon);
    if (search.starred) body += "&star=1";

    auto req = boomlings(std::move(body));
    auto res = co_await req.post("https://www.boomlings.com/database/getGJLevels21.php");
    if (!res.ok()) co_return Err(fmt::format("Geometry Dash servers: error {}", res.code()));
    co_return parseLevels(res.string().unwrapOr(""));
}

arc::Future<Result<long long>> fetchPlayerID(std::string name) {
    auto req = boomlings(fmt::format("gameVersion=22&binaryVersion=45&str={}&page=0&total=0&secret=Wmfd2893gb7", urlEncode(name)));
    auto res = co_await req.post("https://www.boomlings.com/database/getGJUsers20.php");
    if (!res.ok()) co_return Err(fmt::format("Geometry Dash servers: error {}", res.code()));
    auto body = res.string().unwrapOr("");
    if (body.empty() || body == "-1") co_return Err(fmt::format("No player called {}.", name));
    // users are split by '|', the page info follows '#'
    auto users = split(split(body, "#")[0], "|");
    long long first = 0;
    for (auto const& u : users) {
        auto m = pairs(u, ":");
        long long id = num(m, "2");
        if (!first) first = id;
        if (utils::string::toLower(str(m, "1")) == utils::string::toLower(name)) co_return Ok(id);
    }
    if (first) co_return Ok(first);
    co_return Err(fmt::format("No player called {}.", name));
}

arc::Future<Result<std::vector<long long>>> fetchArtistSongs(std::string artist, int max) {
    // Newgrounds user pages: <name>.newgrounds.com, letters, digits and dashes only
    std::string user;
    for (unsigned char c : artist) {
        if (std::isalnum(c)) user += static_cast<char>(std::tolower(c));
        else if (c == ' ' || c == '-' || c == '_') user += '-';
    }
    if (user.empty()) co_return Err("Type the song author's Newgrounds name.");

    if (max <= 0) max = 1000;
    std::vector<long long> ids;
    for (int page = 1; page <= 60 && static_cast<int>(ids.size()) < max; page++) {
        web::WebRequest req;
        // with this header Newgrounds answers with JSON instead of a full page
        req.header("X-Requested-With", "XMLHttpRequest");
        req.timeout(std::chrono::seconds(30));
        auto res = co_await req.get(fmt::format("https://{}.newgrounds.com/audio/page/{}", user, page));
        if (res.code() == 404) {
            if (page == 1) co_return Err(fmt::format("No Newgrounds artist called {}.", artist));
            break;
        }
        if (!res.ok()) {
            if (ids.empty()) co_return Err(fmt::format("Newgrounds: error {}", res.code()));
            break;
        }
        auto text = res.string().unwrapOr("");
        size_t before = ids.size();
        // links look like /audio/listen/123456 (slashes may be escaped in the JSON)
        for (size_t pos = 0; (pos = text.find("listen", pos)) != std::string::npos; pos += 6) {
            size_t i = pos + 6;
            if (i < text.size() && text[i] == '\\') i++;
            if (i >= text.size() || text[i] != '/') continue;
            i++;
            size_t start = i;
            while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) i++;
            if (i == start) continue;
            long long id = std::strtoll(text.substr(start, i - start).c_str(), nullptr, 10);
            if (std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
            if (static_cast<int>(ids.size()) >= max) break;
        }
        bool more = text.find("\"more\":null") == std::string::npos && text.find("\"more\":\"") != std::string::npos;
        if (ids.size() == before || !more) break;
    }
    if (ids.empty()) co_return Err(fmt::format("{} has no songs on Newgrounds.", artist));
    co_return Ok(std::move(ids));
}

static std::string urlDecode(std::string const& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size() && std::isxdigit(static_cast<unsigned char>(s[i + 1])) && std::isxdigit(static_cast<unsigned char>(s[i + 2]))) {
            out += static_cast<char>(std::strtol(s.substr(i + 1, 2).c_str(), nullptr, 16));
            i += 2;
        } else out += s[i] == '+' ? ' ' : s[i];
    }
    return out;
}

arc::Future<Result<GDSong>> fetchSongInfo(long long id) {
    // the game's own song lookup: 1~|~id~|~2~|~name~|~...~|~4~|~artist~|~...~|~10~|~url
    {
        auto req = boomlings(fmt::format("songID={}&secret=Wmfd2893gb7", id));
        auto res = co_await req.post("https://www.boomlings.com/database/getGJSongInfo.php");
        auto body = res.ok() ? res.string().unwrapOr("") : std::string();
        if (!body.empty() && body[0] != '-') {
            auto m = pairs(body, "~|~");
            GDSong song;
            song.id = id;
            song.name = str(m, "2");
            song.artist = str(m, "4");
            song.url = urlDecode(str(m, "10"));
            if (!song.url.empty()) co_return Ok(std::move(song));
        }
    }
    // not in the game's database: ask Newgrounds' audio player for the file
    web::WebRequest req;
    req.header("X-Requested-With", "XMLHttpRequest");
    req.timeout(std::chrono::seconds(30));
    auto res = co_await req.get(fmt::format("https://www.newgrounds.com/audio/load/{}/3", id));
    if (!res.ok()) co_return Err(fmt::format("Song {}: not on the GD servers or Newgrounds (error {})", id, res.code()));
    auto json = res.json();
    if (!json) co_return Err(fmt::format("Song {}: Newgrounds sent an unreadable reply", id));
    auto v = json.unwrap();
    GDSong song;
    song.id = id;
    song.name = v["title"].asString().unwrapOr("");
    // the author field can come wrapped in a link
    {
        std::string clean, raw = v["author"].asString().unwrapOr("");
        bool tag = false;
        for (char c : raw) { if (c == '<') tag = true; else if (c == '>') tag = false; else if (!tag) clean += c; }
        song.artist = clean;
    }
    if (v["sources"].isArray()) for (auto const& src : v["sources"]) {
        if (src["src"].isString()) { song.url = src["src"].asString().unwrap(); break; }
    }
    if (song.url.empty() && v["url"].isString()) song.url = v["url"].asString().unwrap();
    if (song.url.empty()) co_return Err(fmt::format("Song {}: no download link (it may be removed or not allowed in GD)", id));
    co_return Ok(std::move(song));
}

}
