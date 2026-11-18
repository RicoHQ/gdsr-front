#include <Geode/Geode.hpp>
#include <Geode/modify/LevelInfoLayer.hpp>
#include "Api.hpp"
#include "ui/SubmitPopup.hpp"

using namespace geode::prelude;

$on_mod(Loaded) {
    gdsr::loadSavedSession();
}

class $modify(GDSRLevelInfoLayer, LevelInfoLayer) {
    bool init(GJGameLevel* level, bool challenge) {
        if (!LevelInfoLayer::init(level, challenge)) return false;
        if (!Mod::get()->getSettingValue<bool>("show-button")) return true;

        auto spr = CCSprite::create("side_btn.png"_spr);
        if (!spr) return true;
        spr->setScale(34.f / spr->getContentSize().width);
        auto btn = CCMenuItemSpriteExtra::create(spr, this, menu_selector(GDSRLevelInfoLayer::onGDSR));
        btn->setID("gdsr-button"_spr);

        if (auto menu = this->getChildByID("left-side-menu")) {
            menu->addChild(btn);
            menu->updateLayout();
        } else {
            // without Node IDs: our own small menu on the left edge
            auto winSize = CCDirector::get()->getWinSize();
            auto ownMenu = CCMenu::create();
            ownMenu->setID("gdsr-menu"_spr);
            ownMenu->setPosition({ 30.f, winSize.height / 2 - 40.f });
            ownMenu->addChild(btn);
            this->addChild(ownMenu, 10);
        }
        return true;
    }

    void onGDSR(CCObject*) {
        std::string exact;
        if (m_exactLengthLabel) exact = m_exactLengthLabel->getString();
        if (auto popup = gdsr::SubmitPopup::create(m_level, exact)) popup->show();
    }
};
