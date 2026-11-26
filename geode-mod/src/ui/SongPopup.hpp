#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/SliderNode.hpp>
#include <Geode/utils/async.hpp>
#include <functional>
#include "../net/Gdsr.hpp"

namespace gdsr {
    class SongPopup : public geode::Popup {
    protected:
        std::string m_songId;
        std::function<void()> m_onChanged;
        std::optional<MyVote> m_vote;
        bool m_voteLoaded = false;
        int m_value = 70;
        bool m_busy = false;

        cocos2d::CCLabelBMFont* m_score = nullptr;
        cocos2d::CCLabelBMFont* m_votes = nullptr;
        cocos2d::CCLabelBMFont* m_valueLabel = nullptr;
        cocos2d::CCLabelBMFont* m_status = nullptr;
        cocos2d::CCLabelBMFont* m_rateTitle = nullptr;
        geode::SliderNode* m_slider = nullptr;
        CCMenuItemSpriteExtra* m_playBtn = nullptr;
        CCMenuItemSpriteExtra* m_saveBtn = nullptr;
        CCMenuItemSpriteExtra* m_removeBtn = nullptr;
        CCMenuItemSpriteExtra* m_signInBtn = nullptr;
        std::string m_lastKey = "?";

        geode::async::TaskHolder<geode::Result<std::optional<MyVote>>> m_voteTask;
        geode::async::TaskHolder<geode::Result<>> m_saveTask;
        geode::async::TaskHolder<geode::Result<>> m_reloadTask;
        geode::async::TaskHolder<geode::Result<std::filesystem::path>> m_audioTask;

        bool init(std::string songId, std::function<void()> onChanged);
        void onClose(cocos2d::CCObject*) override;
        Song const* song() const { return catalog().byId(m_songId); }

        void refreshScore();
        void refreshRating();
        void refreshPlay();
        void setStatus(std::string const& text, cocos2d::ccColor3B color);
        void setValue(int v);

        void onPlay(cocos2d::CCObject*);
        void onSite(cocos2d::CCObject*);
        void onEdit(cocos2d::CCObject*);
        void onSave(cocos2d::CCObject*);
        void onRemove(cocos2d::CCObject*);
        void onSignIn(cocos2d::CCObject*);
        void onMinus(cocos2d::CCObject*);
        void onPlus(cocos2d::CCObject*);
        void afterChange(std::string const& message);

    public:
        static SongPopup* create(std::string songId, std::function<void()> onChanged);
    };
}
