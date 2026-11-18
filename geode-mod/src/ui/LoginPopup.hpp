#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <Geode/ui/TextInput.hpp>
#include <Geode/utils/async.hpp>

namespace gdsr {
    class LoginPopup : public geode::Popup {
    protected:
        geode::TextInput* m_email = nullptr;
        geode::TextInput* m_password = nullptr;
        cocos2d::CCLabelBMFont* m_status = nullptr;
        CCMenuItemSpriteExtra* m_submit = nullptr;
        geode::Function<void()> m_onDone;
        geode::async::TaskHolder<geode::Result<>> m_task;
        bool m_busy = false;

        bool init(geode::Function<void()> onDone);
        void onSubmit(cocos2d::CCObject*);
        void onSignUp(cocos2d::CCObject*);
        void setStatus(std::string const& text, cocos2d::ccColor3B color);

    public:
        static LoginPopup* create(geode::Function<void()> onDone);
    };
}
