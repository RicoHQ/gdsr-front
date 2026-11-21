#include "GDServers.hpp"

#include <cctype>
#include <chrono>
#include <map>

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
    std::string body = fmt::format("gameVersion=22&binaryVersion=45&type={}&str=&diff={}&len={}&page={}&total=0&secret=Wmfd2893gb7",
        search.type, search.diffs.empty() ? "-" : joined(search.diffs), search.lengths.empty() ? "-" : joined(search.lengths), page);
    if (search.diffs.size() == 1 && search.diffs[0] == -2 && search.demon >= 1 && search.demon <= 5)
        body += fmt::format("&demonFilter={}", search.demon);
    if (search.starred) body += "&star=1";

    web::WebRequest req;
    // the servers reject requests that send a user agent
    req.userAgent("");
    req.header("Content-Type", "application/x-www-form-urlencoded");
    req.header("Accept", "*/*");
    req.bodyString(body);
    req.timeout(std::chrono::seconds(30));
    auto res = co_await req.post("https://www.boomlings.com/database/getGJLevels21.php");
    if (!res.ok()) co_return Err(fmt::format("Geometry Dash servers: error {}", res.code()));
    co_return parseLevels(res.string().unwrapOr(""));
}

}
