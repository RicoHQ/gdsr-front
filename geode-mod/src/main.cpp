#include <set>
#include <Geode/Geode.hpp>
#include <Geode/modify/LevelInfoLayer.hpp>
#include <Geode/modify/MenuLayer.hpp>
#include <Geode/modify/LevelSearchLayer.hpp>
#include "net/Supabase.hpp"
#include "ui/SubmitPopup.hpp"
#include "ui/HubPopup.hpp"
#include "ui/ImportPopup.hpp"
#include "features/JukeboxSync.hpp"
#include "audio/Player.hpp"

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
        // admins: send this song ID's Jukebox songs to GDSR in the background
        std::set<int> ids;
        if (m_level->m_songID > 0) ids.insert(m_level->m_songID);
        std::string extra = m_level->m_songIDs;
        size_t at = 0;
        while (at < extra.size()) {
            auto comma = extra.find(',', at);
            auto part = extra.substr(at, comma == std::string::npos ? std::string::npos : comma - at);
            if (auto id = geode::utils::numFromString<int>(part); id && id.unwrap() > 0) ids.insert(id.unwrap());
            if (comma == std::string::npos) break;
            at = comma + 1;
        }
        for (int id : ids) gdsr::syncJukeboxSongs(id);
    }
};

class $modify(GDSRMenuLayer, MenuLayer) {
    bool init() {
        if (!MenuLayer::init()) return false;
        if (!Mod::get()->getSettingValue<bool>("show-menu-button")) return true;

        auto spr = CCSprite::create("side_btn.png"_spr);
        if (!spr) return true;
        spr->setScale(40.f / spr->getContentSize().width);
        auto btn = CCMenuItemSpriteExtra::create(spr, this, menu_selector(GDSRMenuLayer::onGDSRHub));
        btn->setID("gdsr-hub-button"_spr);

        if (auto menu = this->getChildByID("bottom-menu")) {
            menu->addChild(btn);
            menu->updateLayout();
        } else {
            auto winSize = CCDirector::get()->getWinSize();
            auto ownMenu = CCMenu::create();
            ownMenu->setID("gdsr-menu"_spr);
            ownMenu->setPosition({ winSize.width - 30.f, 30.f });
            ownMenu->addChild(btn);
            this->addChild(ownMenu, 10);
        }
        return true;
    }

    void onGDSRHub(CCObject*) {
        if (auto popup = gdsr::HubPopup::create(0)) popup->show();
    }
};

class $modify(GDSRLevelSearchLayer, LevelSearchLayer) {
    bool init(int type) {
        if (!LevelSearchLayer::init(type)) return false;
        if (!gdsr::signedIn() || !gdsr::session().isAdmin) return true;

        auto spr = CCSprite::create("side_btn.png"_spr);
        if (!spr) return true;
        spr->setScale(30.f / spr->getContentSize().width);
        auto btn = CCMenuItemSpriteExtra::create(spr, this, menu_selector(GDSRLevelSearchLayer::onGDSRImport));
        btn->setID("gdsr-import-button"_spr);

        if (auto menu = this->getChildByID("other-filter-menu")) {
            menu->addChild(btn);
            menu->updateLayout();
        } else {
            auto winSize = CCDirector::get()->getWinSize();
            auto ownMenu = CCMenu::create();
            ownMenu->setID("gdsr-menu"_spr);
            ownMenu->setPosition({ winSize.width - 26.f, winSize.height / 2 - 60.f });
            ownMenu->addChild(btn);
            this->addChild(ownMenu, 10);
        }
        return true;
    }

    void onGDSRImport(CCObject*) {
        std::string text;
        if (m_searchInput) text = std::string(m_searchInput->getString());
        if (auto popup = gdsr::ImportPopup::create(text)) popup->show();
    }
};
