#pragma once

#include "Data.hpp"

namespace gdsr {
    struct GuessLevel { char const* key; char const* label; float clip; float mult; };
    inline constexpr GuessLevel GUESS_LEVELS[] = {
        { "easy", "Easy", 8.f, 1.f },
        { "normal", "Normal", 4.f, 1.5f },
        { "hard", "Hard", 2.f, 2.f },
        { "insane", "Insane", 1.f, 3.f },
        { "extreme", "Extreme", .5f, 4.f },
        { "extremeplus", "Extreme+", .2f, 5.f },
    };
    inline constexpr int GUESS_LEVEL_COUNT = 6;

    struct GuessConfig {
        std::vector<std::string> types;   // song types that can come up
        bool randomStart = false;         // false: clips start at 0:00
        std::vector<std::string> diffs;   // level difficulties; empty = any song
        int level = 1;                    // index into GUESS_LEVELS
        int rounds = 10;

        static GuessConfig load();
        void save() const;
        GuessLevel const& gameLevel() const { return GUESS_LEVELS[std::clamp(level, 0, GUESS_LEVEL_COUNT - 1)]; }
        std::string bestKey() const;
    };

    std::vector<Song const*> guessPool(GuessConfig const& cfg);
    std::string clipText(float seconds);
}
