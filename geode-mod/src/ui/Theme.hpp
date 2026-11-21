#pragma once

#include <Geode/Geode.hpp>
#include <Geode/ui/NineSlice.hpp>

namespace gdsr::ui {
    inline constexpr cocos2d::ccColor3B TEXT   {230, 240, 234};
    inline constexpr cocos2d::ccColor3B MUTED  {143, 167, 154};
    inline constexpr cocos2d::ccColor3B FAINT  { 93, 115, 103};
    inline constexpr cocos2d::ccColor3B ACCENT { 78, 227, 145};
    inline constexpr cocos2d::ccColor3B DANGER {239, 106, 106};
    inline constexpr cocos2d::ccColor3B GOLD   {242, 201,  76};
    inline constexpr cocos2d::ccColor3B ON_ACCENT{6, 32, 18};

    enum class Style { Primary, Dark, Danger };

    cocos2d::CCLabelBMFont* label(std::string const& text, char const* font, float scale, cocos2d::ccColor3B color);
    // shrinks, then truncates with "..."
    cocos2d::CCLabelBMFont* fitLabel(std::string const& text, char const* font, float scale, cocos2d::ccColor3B color, float maxWidth);
    geode::NineSlice* surface(char const* file, cocos2d::CCSize size);
    cocos2d::CCNode* buttonSprite(std::string const& text, Style style, float width, float height, float textScale = .45f);
    CCMenuItemSpriteExtra* button(std::string const& text, Style style, float width, float height, cocos2d::CCObject* target, cocos2d::SEL_MenuHandler sel, float textScale = .45f);
    void setButtonText(CCMenuItemSpriteExtra* btn, std::string const& text, Style style, float width, float height, float textScale = .45f);
    void setEnabled(CCMenuItemSpriteExtra* btn, bool enabled);
    CCMenuItemSpriteExtra* toggle(std::string const& text, bool on, float width, float height, cocos2d::CCObject* target, cocos2d::SEL_MenuHandler sel, float textScale = .32f);
    void setToggle(CCMenuItemSpriteExtra* btn, std::string const& text, bool on, float width, float height, float textScale = .32f);
    cocos2d::CCNode* iconSprite(char const* icon, Style style, float size);
    CCMenuItemSpriteExtra* iconButton(char const* icon, Style style, float size, cocos2d::CCObject* target, cocos2d::SEL_MenuHandler sel);
    void setIcon(CCMenuItemSpriteExtra* btn, char const* icon, Style style, float size);
    cocos2d::CCSprite* rect(float width, float height, cocos2d::ccColor3B color, GLubyte opacity = 255);
    void sizeRect(cocos2d::CCSprite* r, float width, float height);
    geode::NineSlice* card(cocos2d::CCSize size, bool highlighted = false);
}
