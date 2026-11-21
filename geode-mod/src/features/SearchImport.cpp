#include "SearchImport.hpp"
#include "../net/Supabase.hpp"

#include <algorithm>
#include <cctype>

using namespace geode::prelude;

namespace gdsr {

static std::string trimmed(std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    size_t i = 0;
    while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) i++;
    return s.substr(i);
}

// songs by this author that are already on GDSR (also catches music library songs)
static arc::Future<Result<std::vector<long long>>> gdsrSongsBy(std::string author) {
    std::string pattern;
    for (unsigned char c : author) {
        // characters that mean something to the filter are dropped, the rest is percent-encoded
        if (c == ',' || c == '(' || c == ')' || c == '*' || c == '"' || c == '%' || c == '_') continue;
        if (std::isalnum(c) || c == '-' || c == '.') pattern += static_cast<char>(c);
        else pattern += fmt::format("%{:02X}", c);
    }
    std::vector<long long> ids;
    auto res = co_await rest("GET", "songs?select=song_id&author=ilike." + pattern + "&song_id=not.is.null");
    if (res) {
        auto rows = res.unwrap();
        if (rows.isArray()) for (auto const& r : rows) {
            auto id = static_cast<long long>(r["song_id"].asDouble().unwrapOr(0));
            if (id > 0 && std::find(ids.begin(), ids.end(), id) == ids.end()) ids.push_back(id);
        }
    }
    co_return Ok(std::move(ids));
}

arc::Future<Result<std::vector<ImportStep>>> planImport(ImportMode mode, std::string query, int limit) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    if (!session().isAdmin) co_return Err("Importing is only for admins.");

    query = trimmed(query);
    if (query.empty()) co_return Err("Type something to search for.");
    limit = std::clamp(limit, 1, 50);
    std::vector<ImportStep> steps;

    if (mode == ImportMode::LevelName) {
        for (int p = 0; p < limit; p++) {
            ImportStep s;
            s.search.type = 0;
            s.search.query = query;
            s.page = p;
            s.label = fmt::format("\"{}\" page {}", query, p + 1);
            steps.push_back(std::move(s));
        }
    } else if (mode == ImportMode::Creator) {
        auto player = co_await fetchPlayerID(query);
        if (!player) co_return Err(player.unwrapErr());
        for (int p = 0; p < limit; p++) {
            ImportStep s;
            s.search.type = 5;
            s.search.query = std::to_string(player.unwrap());
            s.page = p;
            s.label = fmt::format("{}'s levels, page {}", query, p + 1);
            steps.push_back(std::move(s));
        }
    } else {
        std::vector<long long> songs;
        auto ng = co_await fetchArtistSongs(query, limit);
        if (ng) songs = ng.unwrap();
        auto known = co_await gdsrSongsBy(query);
        auto knownIDs = std::move(known).unwrapOr(std::vector<long long>{});
        for (auto id : knownIDs) {
            if (static_cast<int>(songs.size()) >= limit) break;
            if (std::find(songs.begin(), songs.end(), id) == songs.end()) songs.push_back(id);
        }
        if (songs.empty()) co_return Err(ng ? std::string("No songs found.") : ng.unwrapErr());
        for (auto id : songs) {
            ImportStep s;
            s.search.type = 1;   // most downloaded first
            s.search.song = id;
            s.take = LEVELS_PER_SONG;
            s.label = fmt::format("Song {}", id);
            steps.push_back(std::move(s));
        }
    }
    co_return Ok(std::move(steps));
}

arc::Future<Result<AfkPage>> runImportStep(ImportStep step, std::set<long long> queuedSongs) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());

    auto fetched = co_await fetchLevels(step.search, step.page);
    if (!fetched) co_return Err(fetched.unwrapErr());
    auto levels = std::move(fetched).unwrap();
    if (static_cast<int>(levels.size()) > step.take) levels.resize(step.take);

    AfkPage out;
    out.page = step.page;
    out.checked = static_cast<int>(levels.size());
    auto jobs = co_await afkJobsFor(std::move(levels), true, true, std::move(queuedSongs));
    if (!jobs) co_return Err(jobs.unwrapErr());
    out.jobs = std::move(jobs).unwrap();
    co_return Ok(std::move(out));
}

}
