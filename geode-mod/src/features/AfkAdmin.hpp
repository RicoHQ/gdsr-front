#pragma once

#include "../net/GDServers.hpp"
#include <set>

namespace gdsr {
    struct AfkJob {
        GDLevel level;
        bool addLevel = false;
        bool addSong = false;
        std::string localPath;       // the song in the game folder, if it's downloaded
    };

    struct AfkPage {
        int page = 0;
        int checked = 0;
        std::vector<AfkJob> jobs;    // only levels with something missing on GDSR
    };

    struct AfkResult {
        bool levelAdded = false;
        bool songAdded = false;
        std::string message;
    };

    arc::Future<geode::Result<AfkPage>> afkFetchPage(GDSearch search, int page, bool levels, bool songs);
    // keeps the levels with something GDSR is missing; `queued` holds song IDs already lined up this run
    arc::Future<geode::Result<std::vector<AfkJob>>> afkJobsFor(std::vector<GDLevel> levels, bool wantLevels, bool wantSongs, std::set<long long> queued);
    arc::Future<geode::Result<AfkResult>> afkImport(AfkJob job);
}
