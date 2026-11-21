#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/Popup.hpp>
#include <functional>
#include "../net/GDServers.hpp"

namespace gdsr {
    // Which level list AFK Admin reads, and the same filters as the game's search screen.
    class AfkFilterPopup : public geode::Popup {
    protected:
        GDSearch m_search;
        std::function<void(GDSearch)> m_onDone;

        std::vector<CCMenuItemSpriteExtra*> m_typeBtns;
        std::vector<CCMenuItemSpriteExtra*> m_diffBtns;
        std::vector<CCMenuItemSpriteExtra*> m_demonBtns;
        std::vector<CCMenuItemSpriteExtra*> m_lenBtns;
        CCMenuItemSpriteExtra* m_starBtn = nullptr;
        cocos2d::CCLabelBMFont* m_demonHint = nullptr;

        bool init(GDSearch search, std::function<void(GDSearch)> onDone);
        void refresh();

        void onType(cocos2d::CCObject*);
        void onDiff(cocos2d::CCObject*);
        void onDemon(cocos2d::CCObject*);
        void onLength(cocos2d::CCObject*);
        void onStar(cocos2d::CCObject*);
        void onClear(cocos2d::CCObject*);
        void onDone(cocos2d::CCObject*);

    public:
        static AfkFilterPopup* create(GDSearch search, std::function<void(GDSearch)> onDone);
    };
}
