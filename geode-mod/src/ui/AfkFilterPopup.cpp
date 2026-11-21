#include "AfkFilterPopup.hpp"
#include "Theme.hpp"

#include <algorithm>
#include <iterator>

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 410.f;
static constexpr float H = 284.f;

struct Face { int code; char const* frame; char const* name; };

// game codes for the diff= field, in the order the game shows them
static Face const DIFFS[] = {
    { -1, "difficulty_00_btn_001.png", "N/A" },
    { -3, "difficulty_auto_btn_001.png", "Auto" },
    { 1, "difficulty_01_btn_001.png", "Easy" },
    { 2, "difficulty_02_btn_001.png", "Normal" },
    { 3, "difficulty_03_btn_001.png", "Hard" },
    { 4, "difficulty_04_btn_001.png", "Harder" },
    { 5, "difficulty_05_btn_001.png", "Insane" },
    { -2, "difficulty_06_btn_001.png", "Demon" },
};
// demonFilter= 1-5
static Face const DEMONS[] = {
    { 1, "difficulty_07_btn_001.png", "Easy" },
    { 2, "difficulty_08_btn_001.png", "Medium" },
    { 3, "difficulty_06_btn_001.png", "Hard" },
    { 4, "difficulty_09_btn_001.png", "Insane" },
    { 5, "difficulty_10_btn_001.png", "Extreme" },
};
static char const* const LENGTHS[] = { "Tiny", "Short", "Medium", "Long", "XL", "Plat." };

static bool has(std::vector<int> const& v, int x) { return std::find(v.begin(), v.end(), x) != v.end(); }
static void flip(std::vector<int>& v, int x) {
    auto it = std::find(v.begin(), v.end(), x);
    if (it == v.end()) v.push_back(x); else v.erase(it);
}

// The game's own difficulty face, with the name under it. Falls back to a plain label.
static CCNode* faceNode(Face const& f, float size) {
    auto node = CCNode::create();
    node->setContentSize({ size, size + 10.f });
    node->setAnchorPoint({ .5f, .5f });
    CCNode* icon = nullptr;
    if (CCSpriteFrameCache::sharedSpriteFrameCache()->spriteFrameByName(f.frame)) {
        auto spr = CCSprite::createWithSpriteFrameName(f.frame);
        float s = size / std::max(spr->getContentSize().width, spr->getContentSize().height);
        spr->setScale(s);
        icon = spr;
    } else {
        icon = ui::label(f.name, "bigFont.fnt", .3f, ui::TEXT);
    }
    icon->setPosition({ size / 2, 10.f + size / 2 });
    icon->setID("icon");
    node->addChild(icon);
    auto name = ui::label(f.name, "chatFont.fnt", .45f, ui::MUTED);
    name->setPosition({ size / 2, 4.f });
    name->setID("name");
    node->addChild(name);
    return node;
}

static void setFaceOn(CCMenuItemSpriteExtra* btn, bool on, bool enabled = true) {
    auto node = btn->getNormalImage();
    ccColor3B tint = on ? ccColor3B{255, 255, 255} : ccColor3B{110, 120, 115};
    GLubyte alpha = enabled ? (on ? 255 : 150) : 60;
    auto icon = node->getChildByID("icon");
    if (auto spr = typeinfo_cast<CCSprite*>(icon)) { spr->setColor(tint); spr->setOpacity(alpha); }
    else if (auto lbl = typeinfo_cast<CCLabelBMFont*>(icon)) { lbl->setColor(tint); lbl->setOpacity(alpha); }
    if (auto name = typeinfo_cast<CCLabelBMFont*>(node->getChildByID("name"))) {
        name->setColor(on ? ui::ACCENT : ui::MUTED);
        name->setOpacity(enabled ? 255 : 90);
    }
    btn->setEnabled(enabled);
}

AfkFilterPopup* AfkFilterPopup::create(GDSearch search, std::function<void(GDSearch)> onDone) {
    auto ret = new AfkFilterPopup();
    if (ret->init(std::move(search), std::move(onDone))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool AfkFilterPopup::init(GDSearch search, std::function<void(GDSearch)> onDone) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_search = std::move(search);
    m_onDone = std::move(onDone);

    auto title = ui::label("LEVEL FILTERS", "bigFont.fnt", .45f, ui::ACCENT);
    title->setPosition({ W / 2, H - 20.f });
    m_mainLayer->addChild(title);

    auto heading = [&](char const* text, float y) {
        auto l = ui::label(text, "chatFont.fnt", .55f, ui::FAINT);
        l->setAnchorPoint({ 0.f, .5f });
        l->setPosition({ 16.f, y });
        m_mainLayer->addChild(l);
    };

    // which list to read
    heading("Level list", H - 40.f);
    auto const& types = searchTypes();
    for (size_t i = 0; i < types.size(); i++) {
        auto btn = ui::toggle(types[i].name, false, 90.f, 19.f, this, menu_selector(AfkFilterPopup::onType), .3f);
        btn->setTag(static_cast<int>(i));
        btn->setPosition({ 16.f + 47.f + (i % 4) * 96.f, H - 58.f - (i / 4) * 23.f });
        m_buttonMenu->addChild(btn);
        m_typeBtns.push_back(btn);
    }

    heading("Difficulty", H - 100.f);
    for (size_t i = 0; i < std::size(DIFFS); i++) {
        auto btn = CCMenuItemSpriteExtra::create(faceNode(DIFFS[i], 28.f), this, menu_selector(AfkFilterPopup::onDiff));
        btn->setTag(static_cast<int>(i));
        btn->setPosition({ 34.f + i * 48.f, H - 128.f });
        m_buttonMenu->addChild(btn);
        m_diffBtns.push_back(btn);
    }

    heading("Demon difficulty", H - 158.f);
    m_demonHint = ui::label("Pick only Demon to choose one", "chatFont.fnt", .45f, ui::FAINT);
    m_demonHint->setAnchorPoint({ 1.f, .5f });
    m_demonHint->setPosition({ W - 16.f, H - 158.f });
    m_mainLayer->addChild(m_demonHint);
    for (size_t i = 0; i < std::size(DEMONS); i++) {
        auto btn = CCMenuItemSpriteExtra::create(faceNode(DEMONS[i], 24.f), this, menu_selector(AfkFilterPopup::onDemon));
        btn->setTag(static_cast<int>(i));
        btn->setPosition({ W / 2 + (static_cast<float>(i) - 2.f) * 56.f, H - 184.f });
        m_buttonMenu->addChild(btn);
        m_demonBtns.push_back(btn);
    }

    heading("Length", H - 212.f);
    for (size_t i = 0; i < std::size(LENGTHS); i++) {
        auto btn = ui::toggle(LENGTHS[i], false, 58.f, 19.f, this, menu_selector(AfkFilterPopup::onLength), .3f);
        btn->setTag(static_cast<int>(i));
        btn->setPosition({ 16.f + 29.f + i * 63.f, H - 230.f });
        m_buttonMenu->addChild(btn);
        m_lenBtns.push_back(btn);
    }

    m_starBtn = ui::toggle("Rated only", false, 84.f, 22.f, this, menu_selector(AfkFilterPopup::onStar), .32f);
    m_starBtn->setPosition({ 16.f + 42.f, 22.f });
    m_buttonMenu->addChild(m_starBtn);

    auto clear = ui::button("Clear", ui::Style::Dark, 70.f, 22.f, this, menu_selector(AfkFilterPopup::onClear), .32f);
    clear->setPosition({ W - 16.f - 84.f - 8.f - 35.f, 22.f });
    m_buttonMenu->addChild(clear);
    auto done = ui::button("Done", ui::Style::Primary, 84.f, 22.f, this, menu_selector(AfkFilterPopup::onDone), .36f);
    done->setPosition({ W - 16.f - 42.f, 22.f });
    m_buttonMenu->addChild(done);

    refresh();
    return true;
}

void AfkFilterPopup::refresh() {
    auto const& types = searchTypes();
    for (size_t i = 0; i < m_typeBtns.size(); i++)
        ui::setToggle(m_typeBtns[i], types[i].name, types[i].id == m_search.type, 90.f, 19.f, .3f);
    for (size_t i = 0; i < m_diffBtns.size(); i++)
        setFaceOn(m_diffBtns[i], has(m_search.diffs, DIFFS[i].code));
    bool demonOnly = m_search.diffs.size() == 1 && m_search.diffs[0] == -2;
    for (size_t i = 0; i < m_demonBtns.size(); i++)
        setFaceOn(m_demonBtns[i], demonOnly && m_search.demon == DEMONS[i].code, true);
    m_demonHint->setVisible(!demonOnly);
    for (size_t i = 0; i < m_lenBtns.size(); i++)
        ui::setToggle(m_lenBtns[i], LENGTHS[i], has(m_search.lengths, static_cast<int>(i)), 58.f, 19.f, .3f);
    ui::setToggle(m_starBtn, "Rated only", m_search.starred, 84.f, 22.f, .32f);
}

void AfkFilterPopup::onType(CCObject* sender) {
    auto i = static_cast<size_t>(static_cast<CCNode*>(sender)->getTag());
    if (i < searchTypes().size()) m_search.type = searchTypes()[i].id;
    refresh();
}

void AfkFilterPopup::onDiff(CCObject* sender) {
    flip(m_search.diffs, DIFFS[static_cast<CCNode*>(sender)->getTag()].code);
    if (!(m_search.diffs.size() == 1 && m_search.diffs[0] == -2)) m_search.demon = 0;
    refresh();
}

void AfkFilterPopup::onDemon(CCObject* sender) {
    int code = DEMONS[static_cast<CCNode*>(sender)->getTag()].code;
    // the game only filters demon tiers when Demon is the only difficulty picked
    m_search.diffs = { -2 };
    m_search.demon = m_search.demon == code ? 0 : code;
    refresh();
}

void AfkFilterPopup::onLength(CCObject* sender) {
    flip(m_search.lengths, static_cast<CCNode*>(sender)->getTag());
    std::sort(m_search.lengths.begin(), m_search.lengths.end());
    refresh();
}

void AfkFilterPopup::onStar(CCObject*) { m_search.starred = !m_search.starred; refresh(); }

void AfkFilterPopup::onClear(CCObject*) {
    int type = m_search.type;
    m_search = GDSearch{};
    m_search.type = type;
    refresh();
}

void AfkFilterPopup::onDone(CCObject* sender) {
    if (m_onDone) m_onDone(m_search);
    Popup::onClose(sender);
}

}
