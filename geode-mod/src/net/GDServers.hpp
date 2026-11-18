#pragma once

#include "Supabase.hpp"

namespace gdsr {
    // a level from the Geometry Dash servers' level lists
    struct GDLevel {
        long long levelID = 0;
        std::string name;
        std::string creator;
        std::string difficulty;
        std::string length;
        int stars = 0;
        long long downloads = 0;
        long long songID = 0;        // 0 when the level uses an official track
        std::string songName;
        std::string songArtist;
        std::string songUrl;         // empty for music library songs
    };

    // one page (10 levels) of the "Most downloaded" search
    arc::Future<geode::Result<std::vector<GDLevel>>> fetchMostDownloaded(int page);
}
