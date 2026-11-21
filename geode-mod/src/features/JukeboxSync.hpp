#pragma once

#include <Geode/Geode.hpp>

namespace gdsr {
    // A song saved in Jukebox for a song ID.
    struct JukeboxSong {
        std::string uniqueID;
        std::string name;
        std::string artist;
        std::string path;    // local file, when it's on this device
        std::string url;     // hosted songs that aren't downloaded yet
    };

    // every song Jukebox has for this song ID, except the original
    std::vector<JukeboxSong> jukeboxSongs(int songID);

    // Admins: adds this song ID's Jukebox songs to GDSR as NONGs in the background.
    // Songs already on GDSR (same name on the same song ID) are skipped. Shows a notification when done.
    void syncJukeboxSongs(int songID);
}
