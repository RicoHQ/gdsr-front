#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/TextInput.hpp>
#include <Geode/ui/LoadingSpinner.hpp>
#include <Geode/utils/async.hpp>
#include <deque>
#include "../features/SearchImport.hpp"

namespace gdsr {
    // Admins: add the levels (and their songs) found by a name, creator or song author search.
    class ImportPopup : public geode::Popup {
    protected:
        ImportMode m_mode = ImportMode::LevelName;
        int m_listType = 1;
        bool m_running = false;
        int m_errors = 0;
        int m_checked = 0, m_levels = 0, m_songs = 0;
        std::deque<ImportStep> m_steps;
        std::deque<AfkJob> m_queue;
        std::set<long long> m_queuedSongs;
        std::deque<std::string> m_log;

        std::vector<CCMenuItemSpriteExtra*> m_modeBtns;
        std::vector<CCMenuItemSpriteExtra*> m_listBtns;
        geode::TextInput* m_query = nullptr;
        geode::TextInput* m_limit = nullptr;
        cocos2d::CCLabelBMFont* m_limitLabel = nullptr;
        cocos2d::CCLabelBMFont* m_hint = nullptr;
        cocos2d::CCLabelBMFont* m_stats = nullptr;
        cocos2d::CCLabelBMFont* m_status = nullptr;
        cocos2d::CCNode* m_logNode = nullptr;
        CCMenuItemSpriteExtra* m_startBtn = nullptr;
        geode::LoadingSpinner* m_spinner = nullptr;

        geode::async::TaskHolder<geode::Result<std::vector<ImportStep>>> m_planTask;
        geode::async::TaskHolder<geode::Result<AfkPage>> m_stepTask;
        geode::async::TaskHolder<geode::Result<AfkResult>> m_importTask;

        bool init(std::string query);
        void refresh();
        void addLog(std::string const& line, cocos2d::ccColor3B color);
        void setStatus(std::string const& text, cocos2d::ccColor3B color);
        void finish(std::string const& text, cocos2d::ccColor3B color);
        void advance();
        void nextStep(float);
        void nextJob(float);

        void onMode(cocos2d::CCObject*);
        void onList(cocos2d::CCObject*);
        void onStart(cocos2d::CCObject*);
        void onClose(cocos2d::CCObject*) override;

    public:
        static ImportPopup* create(std::string query = "");
    };
}
