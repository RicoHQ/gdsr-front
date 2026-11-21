#include "Submit.hpp"
#include "../Config.hpp"

#include <Geode/binding/GJGameLevel.hpp>
#include <regex>
#include <cctype>
#include <chrono>

using namespace geode::prelude;

namespace gdsr {
std::string levelDifficultyName(GJGameLevel* level) {
    if (level->m_demon.value() > 0) {
        switch (level->m_demonDifficulty) {
            case 3: return "Easy Demon";
            case 4: return "Medium Demon";
            case 5: return "Insane Demon";
            case 6: return "Extreme Demon";
            default: return "Hard Demon";
        }
    }
    if (level->m_autoLevel) return "Auto";
    int stars = level->m_stars.value();
    if (stars > 0) {
        if (stars <= 1) return "Auto";
        if (stars == 2) return "Easy";
        if (stars == 3) return "Normal";
        if (stars <= 5) return "Hard";
        if (stars <= 7) return "Harder";
        if (stars <= 9) return "Insane";
    }
    if (level->m_ratings > 0) {
        int avg = level->m_ratingsSum / level->m_ratings;
        switch (avg) {
            case 1: return "Easy";
            case 2: return "Normal";
            case 3: return "Hard";
            case 4: return "Harder";
            case 5: return "Insane";
            default: break;
        }
    }
    return "";
}

std::string levelLengthText(GJGameLevel* level, std::string const& exactLabel) {
    std::smatch m;
    static std::regex const clock(R"((\d+):(\d{1,2}))");
    static std::regex const words(R"((?:(\d+)\s*m)?\s*(\d+)\s*s)");
    if (std::regex_search(exactLabel, m, clock)) {
        return fmt::format("{}:{:02}", std::stoi(m[1].str()), std::stoi(m[2].str()));
    }
    if (std::regex_search(exactLabel, m, words)) {
        int mins = m[1].matched ? std::stoi(m[1].str()) : 0;
        return fmt::format("{}:{:02}", mins, std::stoi(m[2].str()));
    }
    static char const* names[] = { "Tiny", "Short", "Medium", "Long", "XL", "Platformer" };
    int len = level->m_levelLength;
    if (len >= 0 && len <= 5) return names[len];
    return "";
}

std::string mmss(unsigned int seconds) {
    return fmt::format("{}:{:02}", seconds / 60, seconds % 60);
}

static std::string safeFileName(std::string const& name) {
    std::string out;
    for (unsigned char c : name) {
        if (std::isalnum(c) || c == '.' || c == '-' || c == '_') out += static_cast<char>(c);
        else if (!out.empty() && out.back() != '-') out += '-';
    }
    if (out.empty()) out = "audio.mp3";
    if (out.size() > 60) out = out.substr(out.size() - 60);
    return out;
}
arc::Future<Result<RemoteState>> fetchRemote(long long levelID, int songID) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());

    RemoteState state;
    auto lv = co_await rest("GET", fmt::format("levels?select=id,name&level_id=eq.{}", levelID));
    if (!lv) co_return Err(lv.unwrapErr());
    auto lvRows = lv.unwrap();
    if (lvRows.isArray() && lvRows.size() > 0) {
        state.levelExists = true;
        state.levelName = lvRows[0]["name"].asString().unwrapOr("");
    }

    if (!state.levelExists) {
        auto rq = co_await rest("GET", fmt::format("level_requests?select=id&status=eq.pending&level_id=eq.{}&user_id=eq.{}", levelID, session().userId));
        if (rq) {
            auto rows = rq.unwrap();
            state.levelRequested = rows.isArray() && rows.size() > 0;
        }
    }

    if (songID > 0) {
        auto sg = co_await rest("GET", fmt::format("songs?select=id,name,type&song_id=eq.{}", songID));
        if (!sg) co_return Err(sg.unwrapErr());
        auto rows = sg.unwrap();
        if (rows.isArray()) {
            state.songCount = static_cast<int>(rows.size());
            for (auto const& row : rows) {
                state.songNames.push_back(utils::string::toLower(row["name"].asString().unwrapOr("")));
                if (state.originalSongUUID.empty() && row["type"].asString().unwrapOr("") == "original") {
                    state.originalSongUUID = row["id"].asString().unwrapOr("");
                }
            }
        }
    }
    co_return Ok(std::move(state));
}

static Json orNull(std::string const& s) { return s.empty() ? Json(nullptr) : Json(s); }

arc::Future<Result<std::string>> runSubmit(SubmitJob job) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    // the role may have changed since the popup opened
    job.admin = session().isAdmin;

    std::vector<std::string> done;
    Json songIdValue = job.songID > 0 ? Json(static_cast<std::intmax_t>(job.songID)) : Json(nullptr);

    if (job.admin && job.songID > 0 && (job.sendLevel || job.sendSong)) {
        auto ids = co_await rest("POST", "song_ids?on_conflict=song_id",
            matjson::makeObject({ {"song_id", songIdValue} }), "resolution=ignore-duplicates,return=minimal");
        if (!ids) co_return Err("Couldn't register the song ID: " + ids.unwrapErr());
    }

    if (job.sendLevel) {
        auto row = matjson::makeObject({
            {"name", job.levelName},
            {"level_id", Json(static_cast<std::intmax_t>(job.levelID))},
            {"creators", orNull(job.creators)},
            {"verifier", Json(nullptr)},
            {"length", orNull(job.length)},
            {"difficulty", orNull(job.difficulty)},
            {"stars", Json(static_cast<std::intmax_t>(job.stars))},
            {"song_id", songIdValue},
        });
        if (!job.admin) row["user_id"] = session().userId;
        auto res = co_await rest("POST", job.admin ? "levels" : "level_requests", row, "return=minimal");
        if (!res) co_return Err("Level: " + res.unwrapErr());
        done.push_back(job.admin ? "level added" : "level requested");
    }

    if (job.sendSong) {
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        auto objectPath = fmt::format("{}/{}/{}-{}-{}", session().userId, job.admin ? "songs" : "requests", ms, job.songID, safeFileName(job.fileName));
        auto up = co_await uploadAudio(objectPath, std::move(job.audio), job.mime);
        if (!up) co_return Err("Upload: " + up.unwrapErr());

        auto row = matjson::makeObject({
            {"song_id", songIdValue},
            {"name", job.songName},
            {"type", job.type},
            {"author", orNull(job.author)},
            {"length", orNull(job.songLength)},
            {"audio_file", up.unwrap()},
        });
        if (job.type == "mashup") {
            row["song_a"] = orNull(job.songA);
            row["song_b_name"] = orNull(job.songBName);
        }
        if (!job.admin) row["user_id"] = session().userId;
        auto res = co_await rest("POST", job.admin ? "songs" : "song_requests", row, "return=minimal");
        if (!res) co_return Err("Song: " + res.unwrapErr());
        done.push_back(job.admin ? "song added" : "song requested");
    }

    std::string summary;
    for (size_t i = 0; i < done.size(); i++) {
        if (i) summary += i + 1 == done.size() ? " and " : ", ";
        summary += done[i];
    }
    if (!summary.empty()) summary[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(summary[0])));
    co_return Ok(summary);
}

}
