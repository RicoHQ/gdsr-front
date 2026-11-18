#pragma once

#include <Geode/Geode.hpp>

namespace gdsr {
    enum class AudioOrigin { None, Official, Newgrounds, Library, Jukebox };

    struct AudioInfo {
        AudioOrigin origin = AudioOrigin::None;
        int songID = 0;            // GD song ID (0 for official tracks)
        std::string name;          // song title as the game / Jukebox knows it
        std::string artist;
        std::string fileName;      // file name only, for messages and the upload path
        std::string path;          // full path (may be inside the APK on Android for official tracks)
        bool readable = false;
        std::string problem;       // why it can't be used, when not readable
        unsigned long size = 0;
    };

    // finds the audio a level plays, preferring the active Jukebox NONG when enabled
    AudioInfo findLevelAudio(GJGameLevel* level);

    // reads the whole file (works for APK assets on Android too)
    geode::Result<geode::ByteVector> readAudio(AudioInfo const& info);

    // duration in seconds using FMOD, 0 when unknown
    unsigned int audioDurationSeconds(geode::ByteVector const& data);

    std::string mimeFor(std::string const& fileName);
    std::string originLabel(AudioOrigin origin);
    std::string formatBytes(unsigned long bytes);
}
