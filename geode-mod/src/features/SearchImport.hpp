#pragma once

#include "AfkAdmin.hpp"

namespace gdsr {
    enum class ImportMode { LevelName, Creator, SongAuthor };

    // one request to the level search
    struct ImportStep {
        GDSearch search;
        int page = 0;
        int take = 10;               // keep only the first N results
        std::string label;
    };

    // Works out which searches to run.
    // LevelName and Creator: `limit` pages of results. SongAuthor: up to `limit` songs, 5 levels each.
    arc::Future<geode::Result<std::vector<ImportStep>>> planImport(ImportMode mode, std::string query, int limit);

    // Runs one search and keeps what GDSR is missing.
    arc::Future<geode::Result<AfkPage>> runImportStep(ImportStep step, std::set<long long> queuedSongs);

    inline constexpr int LEVELS_PER_SONG = 5;
}
