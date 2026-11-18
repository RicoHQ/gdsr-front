#include "Theme.hpp"

using namespace geode::prelude;

namespace gdsr::ui {

CCLabelBMFont* label(std::string const& text, char const* font, float scale, ccColor3B color) {
    auto lbl = CCLabelBMFont::create(text.c_str(), font);
    lbl->setScale(scale);
    lbl->setColor(color);
    return lbl;
}

CCLabelBMFont* fitLabel(std::string const& text, char const* font, float scale, ccColor3B color, float maxWidth) {
    auto lbl = label(text, font, scale, color);
    float w = lbl->getContentSize().width * scale;
    if (w <= maxWidth) return lbl;
    // shrink a little first, then truncate
    float minScale = scale * .75f;
    float fitted = maxWidth / lbl->getContentSize().width;
    if (fitted >= minScale) { lbl->setScale(fitted); return lbl; }
    lbl->setScale(minScale);
    std::string cut = text;
    while (cut.size() > 1 && lbl->getContentSize().width * minScale > maxWidth) {
        cut.pop_back();
        while (!cut.empty() && (static_cast<unsigned char>(cut.back()) & 0xC0) == 0x80) cut.pop_back(); // keep UTF-8 intact
        lbl->setString((cut + "...").c_str());
    }
    return lbl;
}

NineSlice* surface(char const* file, CCSize size) {
    auto s = NineSlice::create(file);
    s->setContentSize(size);
    return s;
}

static char const* textureFor(Style style) {
    switch (style) {
        case Style::Primary: return "btn_green.png"_spr;
        case Style::Danger: return "btn_red.png"_spr;
        default: return "btn_dark.png"_spr;
    }
}

CCNode* buttonSprite(std::string const& text, Style style, float width, float height, float textScale) {
    auto node = CCNode::create();
    node->setContentSize({ width, height });
    node->setAnchorPoint({ .5f, .5f });

    auto bg = surface(textureFor(style), { width, height });
    bg->setPosition(width / 2, height / 2);
    bg->setID("bg");
    node->addChild(bg);

    auto color = style == Style::Primary ? ON_ACCENT : (style == Style::Danger ? DANGER : TEXT);
    auto lbl = fitLabel(text, "bigFont.fnt", textScale, color, width - 14.f);
    lbl->setPosition(width / 2, height / 2 + 1.f);
    lbl->setID("label");
    node->addChild(lbl);
    return node;
}

CCMenuItemSpriteExtra* button(std::string const& text, Style style, float width, float height, CCObject* target, SEL_MenuHandler sel, float textScale) {
    auto btn = CCMenuItemSpriteExtra::create(buttonSprite(text, style, width, height, textScale), target, sel);
    return btn;
}

void setButtonText(CCMenuItemSpriteExtra* btn, std::string const& text, Style style, float width, float height, float textScale) {
    if (!btn) return;
    btn->setNormalImage(buttonSprite(text, style, width, height, textScale));
    btn->setContentSize({ width, height });
}

void setEnabled(CCMenuItemSpriteExtra* btn, bool enabled) {
    if (!btn) return;
    btn->setEnabled(enabled);
    if (auto img = btn->getNormalImage()) {
        for (auto child : CCArrayExt<CCNode*>(img->getChildren())) {
            if (auto rgba = typeinfo_cast<CCRGBAProtocol*>(child)) rgba->setOpacity(enabled ? 255 : 110);
        }
    }
}

}
