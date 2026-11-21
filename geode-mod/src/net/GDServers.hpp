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

    // the level lists the game's search screen offers
    struct GDSearchType { int id; char const* name; };
    std::vector<GDSearchType> const& searchTypes();

    // filters as the game's search screen sends them
    struct GDSearch {
        int type = 1;                // most downloaded
        std::vector<int> diffs;      // -1 N/A, -3 Auto, 1-5 Easy to Insane, -2 Demon; empty = any
        int demon = 0;               // 1-5 Easy to Extreme Demon; only used when diffs is just Demon
        std::vector<int> lengths;    // 0-5 Tiny to Platformer; empty = any
        bool starred = false;

        matjson::Value toJson() const;
        static GDSearch fromJson(matjson::Value const& v);
        std::string summary() const;
    };

    // one page (10 levels). An empty list means the search has run out of pages.
    arc::Future<geode::Result<std::vector<GDLevel>>> fetchLevels(GDSearch search, int page);
}
