#include "SongPopup.hpp"
#include "LoginPopup.hpp"
#include "Theme.hpp"
#include "../Player.hpp"
#include "../Config.hpp"

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 330.f;
static constexpr float H = 236.f;

SongPopup* SongPopup::create(std::string songId, std::function<void()> onChanged) {
    if (!catalog().byId(songId)) return nullptr;
    auto ret = new SongPopup();
    if (ret->init(std::move(songId), std::move(onChanged))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool SongPopup::init(std::string songId, std::function<void()> onChanged) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_songId = std::move(songId);
    m_onChanged = std::move(onChanged);
    auto s = song();

    auto type = ui::label(utils::string::toUpper(typeLabel(s->type)), "bigFont.fnt", .28f, ui::ACCENT);
    type->setPosition({ W / 2, H - 20.f });
    m_mainLayer->addChild(type);

    auto name = ui::fitLabel(s->name, "bigFont.fnt", .6f, ui::TEXT, W - 60.f);
    name->setPosition({ W / 2, H - 38.f });
    m_mainLayer->addChild(name);

    std::string meta = s->author.empty() ? "" : "by " + s->author;
    if (s->type == "mashup") {
        auto a = catalog().byId(s->songA);
        auto b = catalog().byId(s->songB);
        meta = fmt::format("{} + {}{}", a ? a->name : "?", b ? b->name : (s->songBName.empty() ? "?" : s->songBName), s->author.empty() ? "" : "  -  by " + s->author);
    }
    if (s->songID) meta += fmt::format("{}Song ID {}", meta.empty() ? "" : "  -  ", s->songID);
    if (!s->length.empty()) meta += "  -  " + s->length;
    auto metaLbl = ui::fitLabel(meta, "chatFont.fnt", .62f, ui::MUTED, W - 40.f);
    metaLbl->setPosition({ W / 2, H - 55.f });
    m_mainLayer->addChild(metaLbl);

    // score card
    auto card = ui::card({ W - 40.f, 46.f });
    card->setPosition({ W / 2, H - 92.f });
    m_mainLayer->addChild(card);
    m_score = ui::label("-", "bigFont.fnt", .7f, ui::TEXT);
    m_score->setAnchorPoint({ 0.f, .5f });
    m_score->setPosition({ 34.f, H - 88.f });
    m_mainLayer->addChild(m_score);
    m_votes = ui::label("", "chatFont.fnt", .55f, ui::FAINT);
    m_votes->setAnchorPoint({ 0.f, .5f });
    m_votes->setPosition({ 34.f, H - 104.f });
    m_mainLayer->addChild(m_votes);

    m_playBtn = ui::button("Play", ui::Style::Primary, 74.f, 24.f, this, menu_selector(SongPopup::onPlay), .38f);
    m_playBtn->setPosition({ W - 20.f - 12.f - 37.f - 70.f, H - 92.f });
    m_buttonMenu->addChild(m_playBtn);
    if (s->audioFile.empty()) ui::setEnabled(m_playBtn, false);
    auto site = ui::button("Website", ui::Style::Dark, 64.f, 24.f, this, menu_selector(SongPopup::onSite), .32f);
    site->setPosition({ W - 20.f - 12.f - 32.f, H - 92.f });
    m_buttonMenu->addChild(site);

    // rating
    m_rateTitle = ui::label(s->type == "mashup" ? "RATE THE MASHING QUALITY" : "YOUR RATING", "bigFont.fnt", .28f, ui::MUTED);
    m_rateTitle->setAnchorPoint({ 0.f, .5f });
    m_rateTitle->setPosition({ 22.f, 106.f });
    m_mainLayer->addChild(m_rateTitle);

    m_valueLabel = ui::label("70", "bigFont.fnt", .5f, scoreColor(70.0));
    m_valueLabel->setAnchorPoint({ 1.f, .5f });
    m_valueLabel->setPosition({ W - 22.f, 106.f });
    m_mainLayer->addChild(m_valueLabel);

    Ref<SongPopup> self = this;
    m_slider = SliderNode::create([self](SliderNode*, float value) { self->setValue(static_cast<int>(std::round(value))); });
    m_slider->setMin(0.f);
    m_slider->setMax(100.f);
    m_slider->setValue(70.f);
    float sw = m_slider->getContentSize().width;
    if (sw > 0) m_slider->setScale(std::min(1.f, (W - 100.f) / sw));
    m_slider->setPosition({ W / 2, 82.f });
    m_mainLayer->addChild(m_slider);

    auto minus = ui::button("-", ui::Style::Dark, 22.f, 22.f, this, menu_selector(SongPopup::onMinus), .5f);
    minus->setPosition({ 26.f, 82.f });
    m_buttonMenu->addChild(minus);
    auto plus = ui::button("+", ui::Style::Dark, 22.f, 22.f, this, menu_selector(SongPopup::onPlus), .5f);
    plus->setPosition({ W - 26.f, 82.f });
    m_buttonMenu->addChild(plus);

    m_status = ui::label("", "chatFont.fnt", .6f, ui::MUTED);
    m_status->setAnchorPoint({ 0.f, .5f });
    m_status->setPosition({ 22.f, 28.f });
    m_mainLayer->addChild(m_status);

    m_saveBtn = ui::button("Save rating", ui::Style::Primary, 96.f, 26.f, this, menu_selector(SongPopup::onSave), .36f);
    m_saveBtn->setPosition({ W - 22.f - 48.f, 30.f });
    m_buttonMenu->addChild(m_saveBtn);
    m_removeBtn = ui::button("Remove", ui::Style::Danger, 66.f, 26.f, this, menu_selector(SongPopup::onRemove), .34f);
    m_removeBtn->setPosition({ W - 22.f - 96.f - 6.f - 33.f, 30.f });
    m_buttonMenu->addChild(m_removeBtn);
    m_signInBtn = ui::button("Sign in to rate", ui::Style::Primary, 120.f, 26.f, this, menu_selector(SongPopup::onSignIn), .36f);
    m_signInBtn->setPosition({ W - 22.f - 60.f, 30.f });
    m_buttonMenu->addChild(m_signInBtn);

    Player::get()->setListener(this, [self] { self->refreshPlay(); });
    refreshScore();
    refreshPlay();
    refreshRating();

    if (signedIn()) {
        setStatus("Loading your rating...", ui::FAINT);
        m_voteTask.spawn(loadMyVote(m_songId), [this](Result<std::optional<MyVote>> res) {
            if (!res) { setStatus(res.unwrapErr(), ui::DANGER); return; }
            m_vote = res.unwrap();
            m_voteLoaded = true;
            if (m_vote) setValue(static_cast<int>(std::round(m_vote->score)));
            setStatus(m_vote ? fmt::format("You rated this {}.", static_cast<int>(std::round(m_vote->score))) : "You haven't rated this yet.", ui::FAINT);
            refreshRating();
        });
    }
    return true;
}

void SongPopup::onClose(CCObject* sender) {
    Player::get()->clearListener(this);
    Popup::onClose(sender);
}

void SongPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float max = W - 22.f - 96.f - 80.f - 22.f;
    m_status->setScale(.6f);
    if (m_status->getContentSize().width * .6f > max) m_status->setScale(std::max(.4f, max / m_status->getContentSize().width));
}

void SongPopup::setValue(int v) {
    m_value = std::clamp(v, 0, 100);
    m_valueLabel->setString(fmt::format("{}", m_value).c_str());
    m_valueLabel->setColor(scoreColor(static_cast<double>(m_value)));
    if (m_slider && static_cast<int>(std::round(m_slider->getValue())) != m_value) m_slider->setValue(static_cast<float>(m_value));
}

void SongPopup::onMinus(CCObject*) { setValue(m_value - 1); }
void SongPopup::onPlus(CCObject*) { setValue(m_value + 1); }

void SongPopup::refreshScore() {
    auto s = song();
    if (!s) return;
    auto score = catalog().overall(*s);
    m_score->setString(scoreText(score).c_str());
    m_score->setColor(scoreColor(score));
    m_votes->setString(fmt::format("{} vote{}{}", s->votes, s->votes == 1 ? "" : "s", s->type == "mashup" ? "  -  avg of song A, song B and mashing" : "").c_str());
}

void SongPopup::refreshRating() {
    bool in = signedIn();
    m_signInBtn->setVisible(in ? false : true);
    m_saveBtn->setVisible(in);
    m_removeBtn->setVisible(in && m_vote.has_value());
    m_slider->setEnabled(in);
    ui::setEnabled(m_saveBtn, in && m_voteLoaded && !m_busy);
    ui::setEnabled(m_removeBtn, in && !m_busy);
    ui::setButtonText(m_saveBtn, m_vote ? "Update" : "Save rating", ui::Style::Primary, 96.f, 26.f, .36f);
    if (!in) setStatus("Ratings use your GDSR account.", ui::FAINT);
}

void SongPopup::refreshPlay() {
    auto p = Player::get();
    bool mine = p->active() && p->id() == m_songId;
    std::string key = mine ? (p->paused() ? "paused" : "playing") : "idle";
    if (key == m_lastKey) return;
    m_lastKey = key;
    ui::setButtonText(m_playBtn, key == "playing" ? "Pause" : key == "paused" ? "Resume" : "Play", ui::Style::Primary, 74.f, 24.f, .38f);
    if (song() && song()->audioFile.empty()) ui::setEnabled(m_playBtn, false);
}

void SongPopup::onPlay(CCObject*) {
    auto p = Player::get();
    if (p->active() && p->id() == m_songId) { p->togglePause(); return; }
    auto s = song();
    if (!s || s->audioFile.empty()) return;
    std::string title = s->name + (s->author.empty() ? "" : "  -  " + s->author);
    ui::setButtonText(m_playBtn, "Loading", ui::Style::Primary, 74.f, 24.f, .34f);
    m_lastKey = "loading";
    auto id = m_songId;
    m_audioTask.spawn(fetchAudio(s->audioFile), [this, id, title](Result<std::filesystem::path> res) {
        if (!res) { setStatus(res.unwrapErr(), ui::DANGER); m_lastKey = "?"; refreshPlay(); return; }
        auto played = Player::get()->play(res.unwrap(), id, title);
        if (!played) setStatus(played.unwrapErr(), ui::DANGER);
        m_lastKey = "?";
        refreshPlay();
    });
}

void SongPopup::onSite(CCObject*) {
    web::openLinkInBrowser(fmt::format("{}#song-{}", SITE_URL, m_songId));
}

void SongPopup::afterChange(std::string const& message) {
    // reload the scores so the new average shows everywhere
    setStatus(message + " Updating scores...", ui::ACCENT);
    m_reloadTask.spawn(loadCatalog(), [this, message](Result<>) {
        m_busy = false;
        refreshScore();
        refreshRating();
        setStatus(message, ui::ACCENT);
        if (m_onChanged) m_onChanged();
    });
}

void SongPopup::onSave(CCObject*) {
    if (m_busy || !signedIn()) return;
    m_busy = true;
    refreshRating();
    setStatus("Saving...", ui::MUTED);
    double score = m_value;
    m_saveTask.spawn(saveVote(m_songId, m_vote, score), [this, score](Result<> res) {
        if (!res) { m_busy = false; refreshRating(); setStatus(res.unwrapErr(), ui::DANGER); return; }
        // pick up the vote id for later updates
        m_voteTask.spawn(loadMyVote(m_songId), [this](Result<std::optional<MyVote>> v) {
            if (v) m_vote = v.unwrap();
            refreshRating();
        });
        afterChange(fmt::format("Rated {}.", static_cast<int>(score)));
    });
}

void SongPopup::onRemove(CCObject*) {
    if (m_busy || !m_vote) return;
    m_busy = true;
    refreshRating();
    setStatus("Removing...", ui::MUTED);
    m_saveTask.spawn(removeVote(m_vote->id), [this](Result<> res) {
        if (!res) { m_busy = false; refreshRating(); setStatus(res.unwrapErr(), ui::DANGER); return; }
        m_vote.reset();
        afterChange("Rating removed.");
    });
}

void SongPopup::onSignIn(CCObject*) {
    Ref<SongPopup> self = this;
    LoginPopup::create([self] {
        self->refreshRating();
        self->m_voteTask.spawn(loadMyVote(self->m_songId), [self](Result<std::optional<MyVote>> res) {
            self->m_voteLoaded = true;
            if (res) { self->m_vote = res.unwrap(); if (self->m_vote) self->setValue(static_cast<int>(std::round(self->m_vote->score))); }
            self->refreshRating();
            self->setStatus("", ui::FAINT);
        });
    })->show();
}

}
