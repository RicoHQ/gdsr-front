#pragma once

#include <Geode/Geode.hpp>
#include <filesystem>
#include <functional>

namespace FMOD { class Sound; class Channel; }

namespace gdsr {
    // Plays GDSR songs through the game's own FMOD system. The menu music is
    // paused while something plays and comes back when it stops.
    class Player : public cocos2d::CCObject {
    public:
        static Player* get();

        // startMs: where to start; clipMs: stop after this long (0 = play to the end)
        geode::Result<> play(std::filesystem::path const& file, std::string id, std::string title, unsigned startMs = 0, unsigned clipMs = 0);
        void togglePause();
        void stop();

        bool active() const { return m_channel != nullptr; }
        bool paused() const;
        std::string const& id() const { return m_id; }
        std::string const& title() const { return m_title; }
        unsigned positionMs() const;
        unsigned lengthMs() const { return m_lengthMs; }
        // 0..1 through the current clip (or the whole song)
        float progress() const;

        // open GDSR windows listen for playback changes (called often while playing)
        void setListener(void* owner, std::function<void()> fn);
        void clearListener(void* owner);

        void tick(float);

    private:
        FMOD::Sound* m_sound = nullptr;
        FMOD::Channel* m_channel = nullptr;
        geode::ByteVector m_data;
        std::string m_id, m_title;
        unsigned m_startMs = 0, m_clipMs = 0, m_lengthMs = 0;
        bool m_pausedMenuMusic = false;
        bool m_scheduled = false;
        std::vector<std::pair<void*, std::function<void()>>> m_listeners;

        void freeSound();
        void notify();
    };

    unsigned audioLengthMs(std::filesystem::path const& file);
}
