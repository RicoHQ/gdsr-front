#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/LoadingSpinner.hpp>
#include <Geode/ui/TextInput.hpp>
#include <Geode/utils/async.hpp>
#include <deque>
#include <functional>
#include "../features/AfkAdmin.hpp"

namespace gdsr {
    class AfkPopup : public geode::Popup {
    protected:
        bool m_running = false;
        bool m_doLevels = true;
        bool m_doSongs = true;
        int m_page = 0;
        bool m_reachedEnd = false;
        GDSearch m_search;
        int m_checked = 0, m_levels = 0, m_songs = 0, m_errors = 0;
        std::deque<AfkJob> m_queue;
        std::deque<std::string> m_log;
        std::function<void()> m_onChanged;

        CCMenuItemSpriteExtra* m_startBtn = nullptr;
        CCMenuItemSpriteExtra* m_levelsBtn = nullptr;
        CCMenuItemSpriteExtra* m_songsBtn = nullptr;
        CCMenuItemSpriteExtra* m_resetBtn = nullptr;
        CCMenuItemSpriteExtra* m_filterBtn = nullptr;
        geode::TextInput* m_pageInput = nullptr;
        cocos2d::CCLabelBMFont* m_filterInfo = nullptr;
        cocos2d::CCLabelBMFont* m_stats = nullptr;
        cocos2d::CCLabelBMFont* m_status = nullptr;
        cocos2d::CCNode* m_logNode = nullptr;
        geode::LoadingSpinner* m_spinner = nullptr;

        geode::async::TaskHolder<geode::Result<AfkPage>> m_pageTask;
        geode::async::TaskHolder<geode::Result<AfkResult>> m_importTask;

        bool init(std::function<void()> onChanged);
        void onClose(cocos2d::CCObject*) override;

        void refresh();
        void addLog(std::string const& line, cocos2d::ccColor3B color);
        void setStatus(std::string const& text, cocos2d::ccColor3B color);
        void step();
        void nextPage(float);
        void nextJob(float);

        void onStart(cocos2d::CCObject*);
        void onLevels(cocos2d::CCObject*);
        void onSongs(cocos2d::CCObject*);
        void onReset(cocos2d::CCObject*);
        void onFilters(cocos2d::CCObject*);
        void setPage(int page);
        void readPageInput();

    public:
        static AfkPopup* create(std::function<void()> onChanged);
    };
}
