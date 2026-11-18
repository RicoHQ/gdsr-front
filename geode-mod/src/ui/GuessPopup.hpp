#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/utils/async.hpp>
#include <functional>
#include "../Guess.hpp"

namespace gdsr {
    // Guess the Song: hear a short clip, pick the right song out of four.
    class GuessPopup : public geode::Popup {
    protected:
        struct Round {
            std::string songId;
            std::vector<std::string> choices;
            int startMs = -1;
            int plays = 0;
            std::string pick;     // "" = not answered, "skip" = skipped
            int points = 0;
        };
        GuessConfig m_cfg;
        std::function<void()> m_onDone;
        std::vector<Round> m_rounds;
        size_t m_index = 0;
        int m_score = 0, m_streak = 0, m_bestStreak = 0;
        bool m_finished = false;
        std::filesystem::path m_audio;      // current round's file, once downloaded
        bool m_loading = false;
        std::string m_playerKey = "?";

        cocos2d::CCNode* m_content = nullptr;
        cocos2d::CCMenu* m_menu = nullptr;
        cocos2d::CCLabelBMFont* m_hud = nullptr;
        cocos2d::CCLabelBMFont* m_hint = nullptr;
        CCMenuItemSpriteExtra* m_playBtn = nullptr;
        cocos2d::CCSprite* m_bar = nullptr;

        geode::async::TaskHolder<geode::Result<std::filesystem::path>> m_audioTask;
        geode::async::TaskHolder<geode::Result<std::filesystem::path>> m_prefetchTask;

        bool init(GuessConfig cfg, std::function<void()> onDone);
        void onClose(cocos2d::CCObject*) override;
        void keyDown(cocos2d::enumKeyCodes key, double timestamp) override;

        void newGame();
        void buildRound();
        void buildResults();
        void loadRoundAudio();
        void playClip(bool reveal);
        void answer(std::string const& id);
        void onPlayer();
        void setHint(std::string const& text, cocos2d::ccColor3B color);

        void onPlay(cocos2d::CCObject*);
        void onChoice(cocos2d::CCObject*);
        void onSkip(cocos2d::CCObject*);
        void onNext(cocos2d::CCObject*);
        void onAgain(cocos2d::CCObject*);
        void onQuit(cocos2d::CCObject*);

    public:
        static GuessPopup* create(GuessConfig cfg, std::function<void()> onDone);
    };
}
