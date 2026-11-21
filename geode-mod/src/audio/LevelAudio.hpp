#pragma once

#include <Geode/Geode.hpp>

namespace gdsr {
    enum class AudioOrigin { None, Official, Newgrounds, Library, Jukebox };

    struct AudioInfo {
        AudioOrigin origin = AudioOrigin::None;
        int songID = 0;            // GD song ID (0 for official tracks)
        std::string name;
        std::string artist;
        std::string fileName;
        std::string path;          // full path (may be inside the APK on Android for official tracks)
        bool readable = false;
        std::string problem;       // why it can't be used, when not readable
        unsigned long size = 0;
    };

    // finds the audio a level plays, preferring the active Jukebox NONG when enabled
    AudioInfo findLevelAudio(GJGameLevel* level);

    // also reads APK assets on Android
    geode::Result<geode::ByteVector> readAudio(AudioInfo const& info);

    unsigned int audioDurationSeconds(geode::ByteVector const& data);

    std::string mimeFor(std::string const& fileName);
    std::string originLabel(AudioOrigin origin);
    std::string formatBytes(unsigned long bytes);
}
