#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/ScrollLayer.hpp>
#include <Geode/ui/LoadingSpinner.hpp>
#include <Geode/utils/async.hpp>
#include "../Data.hpp"
#include "../Guess.hpp"

namespace gdsr {
    // The GDSR window: browse and play the ranked list, review or follow
    // requests, and set up the Guess the Song game.
    class HubPopup : public geode::Popup {
    protected:
        enum class Tab { Songs, Requests, Guess };
        Tab m_tab = Tab::Songs;
        std::string m_typeFilter;          // "" = all
        bool m_showMine = false;           // admins: own requests instead of the queue
        std::vector<Request> m_requests;
        bool m_requestsLoaded = false;
        std::string m_lastPlaying;
        GuessConfig m_guess;

        cocos2d::CCLabelBMFont* m_modeLabel = nullptr;
        cocos2d::CCNode* m_accountNode = nullptr;
        std::vector<CCMenuItemSpriteExtra*> m_tabButtons;
        cocos2d::CCNode* m_content = nullptr;      // rebuilt per tab
        cocos2d::CCMenu* m_contentMenu = nullptr;
        geode::ScrollLayer* m_scroll = nullptr;
        geode::LoadingSpinner* m_spinner = nullptr;
        cocos2d::CCLabelBMFont* m_status = nullptr;

        // now playing
        CCMenuItemSpriteExtra* m_playBtn = nullptr;
        CCMenuItemSpriteExtra* m_stopBtn = nullptr;
        cocos2d::CCLabelBMFont* m_nowLabel = nullptr;
        cocos2d::CCSprite* m_progressBg = nullptr;
        cocos2d::CCSprite* m_progress = nullptr;

        // guess setup
        cocos2d::CCLabelBMFont* m_poolLabel = nullptr;
        CCMenuItemSpriteExtra* m_startBtn = nullptr;

        geode::async::TaskHolder<geode::Result<>> m_catalogTask;
        geode::async::TaskHolder<geode::Result<std::vector<Request>>> m_requestsTask;
        geode::async::TaskHolder<geode::Result<>> m_reviewTask;
        geode::async::TaskHolder<geode::Result<std::filesystem::path>> m_audioTask;

        bool init(int startTab);
        void onClose(cocos2d::CCObject*) override;
        void update(float dt) override;

        void buildHeader();
        void buildFooter();
        void refreshAccount();
        void refreshTabs();
        void showTab(Tab tab);
        void clearContent();
        void setStatus(std::string const& text, cocos2d::ccColor3B color);
        void setLoading(bool on);

        void buildSongs();
        void buildRequests();
        void buildGuess();
        void refreshGuess();
        cocos2d::CCNode* makeScroll(float height, float contentHeight);

        void loadCatalog(bool thenRebuild);
        void loadRequestsList();
        void playSong(std::string songUUID);
        void playRequest(Request const& req);
        void onPlayer();

        void onTab(cocos2d::CCObject*);
        void onFilter(cocos2d::CCObject*);
        void onSongRow(cocos2d::CCObject*);
        void onSongPlay(cocos2d::CCObject*);
        void onRequestPlay(cocos2d::CCObject*);
        void onApprove(cocos2d::CCObject*);
        void onReject(cocos2d::CCObject*);
        void onToggleMine(cocos2d::CCObject*);
        void onRefresh(cocos2d::CCObject*);
        void onSignIn(cocos2d::CCObject*);
        void onSignOut(cocos2d::CCObject*);
        void onPlayPause(cocos2d::CCObject*);
        void onStop(cocos2d::CCObject*);
        void onSite(cocos2d::CCObject*);

        void onGuessType(cocos2d::CCObject*);
        void onGuessStart(cocos2d::CCObject*);
        void onGuessDiff(cocos2d::CCObject*);
        void onGuessLevel(cocos2d::CCObject*);
        void onGuessRounds(cocos2d::CCObject*);
        void onGuessGo(cocos2d::CCObject*);

        void review(int index, bool approve);

    public:
        static HubPopup* create(int startTab = 0);
    };
}
