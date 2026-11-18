#include "Gdsr.hpp"
#include "../Config.hpp"

#include <algorithm>
#include <cctype>

using namespace geode::prelude;

namespace gdsr {

std::string typeLabel(std::string const& key) {
    if (key == "original") return "Original";
    if (key == "mashup") return "Mashup";
    if (key == "cover") return "Cover";
    if (key == "remix") return "Remix";
    if (key == "nong") return "NONG";
    return key.empty() ? "Song" : key;
}

static Catalog g_catalog;
Catalog& catalog() { return g_catalog; }

static std::optional<double> optNum(Json const& v) {
    if (v.isNumber()) return v.asDouble().unwrapOr(0.0);
    if (v.isString()) {
        auto s = v.asString().unwrapOr("");
        if (s.empty()) return std::nullopt;
        char* end = nullptr;
        double d = std::strtod(s.c_str(), &end);
        if (end && end != s.c_str()) return d;
    }
    return std::nullopt;
}
static long long optInt(Json const& v) {
    if (auto d = optNum(v)) return static_cast<long long>(*d);
    return 0;
}
static std::string str(Json const& v) { return v.isString() ? v.asString().unwrapOr("") : ""; }

Song const* Catalog::byId(std::string const& id) const {
    auto it = index.find(id);
    return it == index.end() ? nullptr : &songs[it->second];
}

static std::optional<double> ownScore(Song const& s) {
    if (s.votes > 0 && s.voteAvg) return s.voteAvg;
    return s.type == "mashup" ? s.mashingQuality : s.rating;
}

std::optional<double> Catalog::overall(Song const& s, int depth) const {
    if (s.type != "mashup") return ownScore(s);
    std::vector<double> parts;
    if (auto q = ownScore(s)) parts.push_back(*q);
    if (depth < 3) {
        if (auto a = byId(s.songA)) { if (auto v = overall(*a, depth + 1)) parts.push_back(*v); }
        if (!s.songB.empty()) {
            if (auto b = byId(s.songB)) { if (auto v = overall(*b, depth + 1)) parts.push_back(*v); }
        } else if (!s.songBName.empty()) {
            if (s.votesB > 0 && s.voteAvgB) parts.push_back(*s.voteAvgB);
            else if (s.songBRating) parts.push_back(*s.songBRating);
        }
    }
    if (parts.empty()) return std::nullopt;
    double sum = 0;
    for (auto p : parts) sum += p;
    return sum / parts.size();
}

std::vector<Song const*> Catalog::ranked(std::string const& type) const {
    std::vector<std::pair<Song const*, std::optional<double>>> list;
    for (auto const& s : songs) if (type.empty() || s.type == type) list.push_back({ &s, overall(s) });
    std::stable_sort(list.begin(), list.end(), [](auto const& a, auto const& b) {
        if (a.second && b.second) return *a.second > *b.second;
        if (a.second != b.second) return a.second.has_value();
        return a.first->name < b.first->name;
    });
    std::vector<Song const*> out;
    for (auto& p : list) out.push_back(p.first);
    return out;
}

arc::Future<Result<>> loadCatalog() {
    if (signedIn()) (void)co_await ensureSession();

    auto songs = co_await rest("GET", "songs?select=id,song_id,name,type,author,length,audio_file,rating,song_a,song_b,mashing_quality,song_b_name,song_b_rating&order=name.asc");
    if (!songs) co_return Err(songs.unwrapErr());
    auto levels = co_await rest("GET", "levels?select=id,name,level_id,difficulty,song_id,stars&order=name.asc");
    if (!levels) co_return Err(levels.unwrapErr());
    auto stats = co_await rest("GET", "song_vote_stats?select=song,votes,avg_score");
    auto statsB = co_await rest("GET", "song_b_vote_stats?select=song,votes,avg_score");

    Catalog c;
    auto rows = songs.unwrap();
    if (rows.isArray()) {
        for (auto const& r : rows) {
            Song s;
            s.id = str(r["id"]);
            s.songID = optInt(r["song_id"]);
            s.name = str(r["name"]);
            s.type = str(r["type"]);
            s.author = str(r["author"]);
            s.length = str(r["length"]);
            s.audioFile = str(r["audio_file"]);
            s.rating = optNum(r["rating"]);
            s.mashingQuality = optNum(r["mashing_quality"]);
            s.songA = str(r["song_a"]);
            s.songB = str(r["song_b"]);
            s.songBName = str(r["song_b_name"]);
            s.songBRating = optNum(r["song_b_rating"]);
            if (s.id.empty()) continue;
            c.index[s.id] = c.songs.size();
            c.songs.push_back(std::move(s));
        }
    }
    auto applyStats = [&](Result<Json>& res, bool songB) {
        if (!res) return;
        auto arr = res.unwrap();
        if (!arr.isArray()) return;
        for (auto const& r : arr) {
            auto it = c.index.find(str(r["song"]));
            if (it == c.index.end()) continue;
            auto& s = c.songs[it->second];
            if (songB) { s.votesB = static_cast<int>(optInt(r["votes"])); s.voteAvgB = optNum(r["avg_score"]); }
            else { s.votes = static_cast<int>(optInt(r["votes"])); s.voteAvg = optNum(r["avg_score"]); }
        }
    };
    applyStats(stats, false);
    applyStats(statsB, true);

    auto lrows = levels.unwrap();
    if (lrows.isArray()) {
        for (auto const& r : lrows) {
            Level l;
            l.id = str(r["id"]);
            l.name = str(r["name"]);
            l.levelID = optInt(r["level_id"]);
            l.difficulty = str(r["difficulty"]);
            l.songID = optInt(r["song_id"]);
            l.stars = static_cast<int>(optInt(r["stars"]));
            c.levels.push_back(std::move(l));
        }
    }
    c.loaded = true;
    g_catalog = std::move(c);
    co_return Ok();
}

static std::string niceDate(std::string const& iso) {
    return iso.size() >= 10 ? iso.substr(0, 10) : iso;
}

arc::Future<Result<std::vector<Request>>> loadRequests(bool adminQueue) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    std::string filter = adminQueue
        ? "status=eq.pending&order=created_at.asc&limit=100"
        : fmt::format("user_id=eq.{}&order=created_at.desc&limit=60", session().userId);

    auto songs = co_await rest("GET", "song_requests?select=id,name,type,author,song_id,status,admin_note,audio_file,created_at&" + filter);
    if (!songs) co_return Err(songs.unwrapErr());
    auto levels = co_await rest("GET", "level_requests?select=id,name,level_id,difficulty,stars,status,admin_note,created_at&" + filter);
    if (!levels) co_return Err(levels.unwrapErr());

    std::vector<Request> out;
    auto srows = songs.unwrap();
    if (srows.isArray()) for (auto const& r : srows) {
        Request q;
        q.id = str(r["id"]);
        q.isSong = true;
        q.name = str(r["name"]);
        auto author = str(r["author"]);
        auto sid = optInt(r["song_id"]);
        q.sub = typeLabel(str(r["type"])) + (author.empty() ? "" : " by " + author) + (sid ? fmt::format("  -  ID {}", sid) : "");
        q.status = str(r["status"]);
        q.note = str(r["admin_note"]);
        q.audioFile = str(r["audio_file"]);
        q.created = niceDate(str(r["created_at"]));
        out.push_back(std::move(q));
    }
    auto lrows = levels.unwrap();
    if (lrows.isArray()) for (auto const& r : lrows) {
        Request q;
        q.id = str(r["id"]);
        q.isSong = false;
        q.name = str(r["name"]);
        auto diff = str(r["difficulty"]);
        q.sub = fmt::format("Level {}{}", optInt(r["level_id"]), diff.empty() ? "" : "  -  " + diff);
        q.status = str(r["status"]);
        q.note = str(r["admin_note"]);
        q.created = niceDate(str(r["created_at"]));
        out.push_back(std::move(q));
    }
    std::stable_sort(out.begin(), out.end(), [adminQueue](Request const& a, Request const& b) {
        return adminQueue ? a.created < b.created : a.created > b.created;
    });
    co_return Ok(std::move(out));
}

arc::Future<Result<>> reviewRequest(Request req, bool approve) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    auto body = matjson::makeObject({
        {"_id", req.id},
        {"_approve", approve},
        {"_note", approve ? Json(nullptr) : Json("Rejected from the GDSR mod")},
    });
    auto res = co_await rest("POST", req.isSong ? "rpc/review_song_request" : "rpc/review_level_request", body);
    if (!res) co_return Err(res.unwrapErr());
    co_return Ok();
}

arc::Future<Result<std::optional<MyVote>>> loadMyVote(std::string songUUID) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    auto res = co_await rest("GET", fmt::format("votes?select=id,score&song=eq.{}&user_id=eq.{}", songUUID, session().userId));
    if (!res) co_return Err(res.unwrapErr());
    auto rows = res.unwrap();
    if (rows.isArray() && rows.size() > 0) {
        MyVote v;
        v.id = str(rows[0]["id"]);
        v.score = optNum(rows[0]["score"]).value_or(0.0);
        co_return Ok(std::optional<MyVote>(v));
    }
    co_return Ok(std::optional<MyVote>());
}

arc::Future<Result<>> saveVote(std::string songUUID, std::optional<MyVote> existing, double score) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    if (existing && !existing->id.empty()) {
        auto res = co_await rest("PATCH", fmt::format("votes?id=eq.{}", existing->id), matjson::makeObject({ {"score", score} }), "return=minimal");
        if (!res) co_return Err(res.unwrapErr());
        co_return Ok();
    }
    auto res = co_await rest("POST", "votes", matjson::makeObject({ {"user_id", session().userId}, {"song", songUUID}, {"score", score} }), "return=minimal");
    if (!res) co_return Err(res.unwrapErr());
    co_return Ok();
}

arc::Future<Result<>> removeVote(std::string voteID) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    auto res = co_await rest("DELETE", fmt::format("votes?id=eq.{}", voteID), std::nullopt, "return=minimal");
    if (!res) co_return Err(res.unwrapErr());
    co_return Ok();
}

static std::string cacheName(std::string const& objectPath) {
    std::string out;
    for (unsigned char c : objectPath) out += (std::isalnum(c) || c == '.' || c == '-' || c == '_') ? static_cast<char>(c) : '_';
    if (out.size() > 120) out = out.substr(out.size() - 120);
    return out;
}

arc::Future<Result<std::filesystem::path>> fetchAudio(std::string objectPath) {
    if (objectPath.empty()) co_return Err("This song has no audio uploaded.");
    auto dir = Mod::get()->getSaveDir() / "audio-cache";
    auto dest = dir / cacheName(objectPath);
    std::error_code ec;
    if (std::filesystem::exists(dest, ec) && std::filesystem::file_size(dest, ec) > 0) co_return Ok(dest);
    auto res = co_await downloadAudio(objectPath, dest);
    if (!res) co_return Err(res.unwrapErr());
    co_return Ok(dest);
}

ccColor3B scoreColor(std::optional<double> s) {
    if (!s) return { 90, 112, 100 };
    if (*s >= 90) return { 92, 240, 154 };
    if (*s >= 80) return { 52, 209, 122 };
    if (*s >= 70) return { 159, 210, 76 };
    if (*s >= 60) return { 217, 194, 74 };
    return { 224, 137, 74 };
}

std::string scoreText(std::optional<double> s) {
    return s ? fmt::format("{:.2f}", *s) : "-";
}

}
