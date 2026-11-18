#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/TextInput.hpp>
#include <Geode/ui/LoadingSpinner.hpp>
#include <Geode/utils/async.hpp>
#include "../AudioSource.hpp"

namespace gdsr {
    struct RemoteState {
        bool levelExists = false;
        std::string levelName;
        bool levelRequested = false;
        int songCount = 0;
        std::vector<std::string> songNames;   // lower-case names already on this song ID
        std::string originalSongUUID;         // an Original on this song ID (Song A for mashups)
    };

    class SubmitPopup : public geode::Popup {
    protected:
        geode::Ref<GJGameLevel> m_level;
        std::string m_exactLength;
        AudioInfo m_audio;
        RemoteState m_remote;
        bool m_remoteLoaded = false;

        bool m_wantLevel = true;
        bool m_wantSong = true;
        std::string m_type = "original";
        bool m_busy = false;

        cocos2d::CCNode* m_accountNode = nullptr;
        cocos2d::CCMenu* m_accountMenu = nullptr;
        cocos2d::CCLabelBMFont* m_modeLabel = nullptr;

        geode::NineSlice* m_levelCard = nullptr;
        geode::NineSlice* m_songCard = nullptr;
        CCMenuItemToggler* m_levelTick = nullptr;
        CCMenuItemToggler* m_songTick = nullptr;
        cocos2d::CCLabelBMFont* m_levelStatus = nullptr;
        cocos2d::CCLabelBMFont* m_songStatus = nullptr;

        std::vector<CCMenuItemSpriteExtra*> m_typeButtons;
        cocos2d::CCLabelBMFont* m_typeTitle = nullptr;
        geode::TextInput* m_nameInput = nullptr;
        geode::TextInput* m_authorInput = nullptr;
        geode::TextInput* m_songBInput = nullptr;

        cocos2d::CCLabelBMFont* m_status = nullptr;
        CCMenuItemSpriteExtra* m_submit = nullptr;
        geode::LoadingSpinner* m_spinner = nullptr;

        geode::async::TaskHolder<geode::Result<RemoteState>> m_checkTask;
        geode::async::TaskHolder<geode::Result<std::string>> m_submitTask;

        bool init(GJGameLevel* level, std::string exactLength);
        void buildHeader();
        void buildLevelCard();
        void buildSongCard();
        void buildSongFields();
        void buildFooter();

        void refreshAccount();
        void refreshCards();
        void refreshSongFields();
        void refreshSubmit();
        void runChecks();
        void setStatus(std::string const& text, cocos2d::ccColor3B color);
        void setBusy(bool busy);

        void onLevelTick(cocos2d::CCObject*);
        void onSongTick(cocos2d::CCObject*);
        void onType(cocos2d::CCObject*);
        void onSignIn(cocos2d::CCObject*);
        void onSignOut(cocos2d::CCObject*);
        void onSubmit(cocos2d::CCObject*);
        void onOpenSite(cocos2d::CCObject*);
        void onOpenHub(cocos2d::CCObject*);

    public:
        static SubmitPopup* create(GJGameLevel* level, std::string exactLength);
    };

    std::string levelDifficultyName(GJGameLevel* level);
    std::string levelLengthText(GJGameLevel* level, std::string const& exactLabel);
}
