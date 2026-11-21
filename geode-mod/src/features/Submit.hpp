#pragma once

#include "../net/Supabase.hpp"
#include "../audio/LevelAudio.hpp"

namespace gdsr {
    struct RemoteState {
        bool levelExists = false;
        std::string levelName;
        bool levelRequested = false;
        int songCount = 0;
        std::vector<std::string> songNames;   // lower-case names already on this song ID
        std::string originalSongUUID;         // an Original on this song ID (Song A for mashups)
    };

    struct SubmitJob {
        bool admin = false;
        bool sendLevel = false;
        bool sendSong = false;
        // level
        std::string levelName;
        long long levelID = 0;
        std::string creators;
        std::string length;
        std::string difficulty;
        int stars = 0;
        int songID = 0;
        // song
        std::string songName;
        std::string author;
        std::string type;
        std::string songLength;
        std::string songA;
        std::string songBName;
        geode::ByteVector audio;
        std::string fileName;
        std::string mime;
    };

    arc::Future<geode::Result<RemoteState>> fetchRemote(long long levelID, int songID);
    arc::Future<geode::Result<std::string>> runSubmit(SubmitJob job);

    std::string levelDifficultyName(GJGameLevel* level);
    std::string levelLengthText(GJGameLevel* level, std::string const& exactLabel);
    std::string mmss(unsigned int seconds);
}
