#pragma once

#include "Api.hpp"
#include <map>

namespace gdsr {
    // A level from the Geometry Dash servers' "Most downloaded" list.
    struct GDLevel {
        long long levelID = 0;
        std::string name;
        std::string creator;
        std::string difficulty;
        std::string length;
        int stars = 0;
        long long downloads = 0;
        long long songID = 0;        // custom (Newgrounds / library) song, 0 for official tracks
        std::string songName;
        std::string songArtist;
        std::string songUrl;         // download link, when the servers give one
    };

    // What still has to be added for one level.
    struct AfkJob {
        GDLevel level;
        bool addLevel = false;
        bool addSong = false;
        std::string localPath;       // the song file in your game folder, if it's downloaded there
    };

    struct AfkPage {
        int page = 0;
        int checked = 0;             // levels on the page
        std::vector<AfkJob> jobs;    // only levels with something missing
    };

    // one page (10 levels) of the most downloaded list, minus what GDSR already has
    arc::Future<geode::Result<AfkPage>> afkFetchPage(int page, bool levels, bool songs);

    struct AfkResult {
        bool levelAdded = false;
        bool songAdded = false;
        std::string message;         // one line for the log
    };
    arc::Future<geode::Result<AfkResult>> afkImport(AfkJob job);
}
