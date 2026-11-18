#pragma once

#include "Supabase.hpp"
#include <filesystem>
#include <unordered_map>

namespace gdsr {
    inline constexpr char const* TYPE_KEYS_ALL[] = { "original", "mashup", "cover", "remix", "nong" };
    inline constexpr char const* TYPE_PLURALS[] = { "Originals", "Mashups", "Covers", "Remixes", "NONGs" };
    inline constexpr int TYPE_COUNT = 5;
    std::string typeLabel(std::string const& key);

    inline constexpr char const* DIFFICULTIES[] = {
        "Auto", "Easy", "Normal", "Hard", "Harder", "Insane",
        "Easy Demon", "Medium Demon", "Hard Demon", "Insane Demon", "Extreme Demon"
    };
    inline constexpr int DIFFICULTY_COUNT = 11;

    struct Song {
        std::string id;
        long long songID = 0;
        std::string name;
        std::string type;
        std::string author;
        std::string length;
        std::string audioFile;
        std::optional<double> rating;
        std::optional<double> mashingQuality;
        std::string songA, songB, songBName;
        std::optional<double> songBRating;
        int votes = 0;
        std::optional<double> voteAvg;
        int votesB = 0;
        std::optional<double> voteAvgB;
    };

    struct Level {
        std::string id;
        std::string name;
        long long levelID = 0;
        std::string difficulty;
        long long songID = 0;
        int stars = 0;
    };

    struct Catalog {
        std::vector<Song> songs;
        std::vector<Level> levels;
        std::unordered_map<std::string, size_t> index;
        bool loaded = false;

        Song const* byId(std::string const& id) const;
        std::optional<double> overall(Song const& s, int depth = 0) const;
        std::vector<Song const*> ranked(std::string const& type = "") const;
    };

    Catalog& catalog();
    arc::Future<geode::Result<>> loadCatalog();

    struct Request {
        std::string id;
        bool isSong = true;
        std::string name;
        std::string sub;          // type + author, or level details
        std::string status;       // pending / approved / rejected
        std::string note;
        std::string audioFile;
        std::string created;
    };
    // adminQueue: every pending request; otherwise only your own
    arc::Future<geode::Result<std::vector<Request>>> loadRequests(bool adminQueue);
    arc::Future<geode::Result<>> reviewRequest(Request req, bool approve);

    struct MyVote { std::string id; double score = 0; };
    arc::Future<geode::Result<std::optional<MyVote>>> loadMyVote(std::string songUUID);
    arc::Future<geode::Result<>> saveVote(std::string songUUID, std::optional<MyVote> existing, double score);
    arc::Future<geode::Result<>> removeVote(std::string voteID);

    // cached in the save dir after the first download
    arc::Future<geode::Result<std::filesystem::path>> fetchAudio(std::string objectPath);

    cocos2d::ccColor3B scoreColor(std::optional<double> score);
    std::string scoreText(std::optional<double> score);
}
