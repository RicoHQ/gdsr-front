#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/TextInput.hpp>
#include <Geode/utils/async.hpp>
#include <functional>

namespace gdsr {
    // Admins: edit a song's name, author, song ID, length and type.
    class SongEditPopup : public geode::Popup {
    protected:
        std::string m_songId;
        std::string m_type;
        bool m_busy = false;
        std::function<void()> m_onSaved;

        geode::TextInput* m_name = nullptr;
        geode::TextInput* m_author = nullptr;
        geode::TextInput* m_gdId = nullptr;
        geode::TextInput* m_length = nullptr;
        std::vector<CCMenuItemSpriteExtra*> m_typeBtns;
        cocos2d::CCLabelBMFont* m_status = nullptr;
        CCMenuItemSpriteExtra* m_saveBtn = nullptr;

        geode::async::TaskHolder<geode::Result<>> m_task;

        bool init(std::string songId, std::function<void()> onSaved);
        geode::TextInput* field(char const* title, float y, float x, float width, std::string const& value, char const* placeholder);
        void refreshTypes();
        void setStatus(std::string const& text, cocos2d::ccColor3B color);
        void onType(cocos2d::CCObject*);
        void onSave(cocos2d::CCObject*);

    public:
        static SongEditPopup* create(std::string songId, std::function<void()> onSaved);
    };
}
