#pragma once

#include "AfkAdmin.hpp"

namespace gdsr {
    enum class ImportMode { LevelName, Creator, SongAuthor, LevelList };

    // one request to the level search
    struct ImportStep {
        GDSearch search;
        int page = 0;
        int take = 10;               // keep only the first N results
        std::string label;
        std::string artist;          // song author mode: used when Newgrounds doesn't name the artist
    };

    // Works out which searches to run.
    // LevelName, Creator and LevelList: `limit` pages of results (LevelList reads the `listType` list).
    // SongAuthor: up to `limit` songs (0 = all of them), 5 levels each, and every song is added even without levels.
    arc::Future<geode::Result<std::vector<ImportStep>>> planImport(ImportMode mode, std::string query, int limit, int listType);

    // Runs one search and keeps what GDSR is missing. For a song step, the song is added
    // by itself when none of its levels brought it in.
    arc::Future<geode::Result<AfkPage>> runImportStep(ImportStep step, std::set<long long> queuedSongs);

    inline constexpr int LEVELS_PER_SONG = 5;
}
