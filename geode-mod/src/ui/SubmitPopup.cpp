#include "SubmitPopup.hpp"
#include "LoginPopup.hpp"
#include "HubPopup.hpp"
#include "Theme.hpp"
#include "../net/Supabase.hpp"
#include "../Config.hpp"

#include <Geode/binding/GJGameLevel.hpp>
#include <cctype>
#include <chrono>

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 420.f;
static constexpr float H = 292.f;
static constexpr float CARD_W = 194.f;
static constexpr float CARD_H = 112.f;
static constexpr float CARD_TOP = H - 60.f;

static char const* TYPE_KEYS[] = { "original", "remix", "cover", "mashup", "nong" };
static char const* TYPE_NAMES[] = { "Original", "Remix", "Cover", "Mashup", "NONG" };
static constexpr int TYPE_N = 5;
SubmitPopup* SubmitPopup::create(GJGameLevel* level, std::string exactLength) {
    auto ret = new SubmitPopup();
    if (ret->init(level, std::move(exactLength))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool SubmitPopup::init(GJGameLevel* level, std::string exactLength) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_level = level;
    m_exactLength = std::move(exactLength);
    m_audio = findLevelAudio(level);
    m_wantSong = m_audio.readable;
    m_type = m_audio.origin == AudioOrigin::Jukebox ? "nong" : "original";

    buildHeader();
    buildLevelCard();
    buildSongCard();
    buildSongFields();
    buildFooter();

    refreshAccount();
    refreshCards();
    refreshSongFields();
    refreshSubmit();
    if (signedIn()) runChecks();
    return true;
}

void SubmitPopup::buildHeader() {
    auto logo = CCSprite::create("side_btn.png"_spr);
    logo->setScale(22.f / logo->getContentSize().width);
    logo->setPosition({ 46.f, H - 25.f });
    m_mainLayer->addChild(logo);

    auto title = ui::label("GDSR", "bigFont.fnt", .62f, ui::TEXT);
    title->setAnchorPoint({ 0.f, .5f });
    title->setPosition({ 63.f, H - 21.f });
    m_mainLayer->addChild(title);

    m_modeLabel = ui::label("", "chatFont.fnt", .62f, ui::MUTED);
    m_modeLabel->setAnchorPoint({ 0.f, .5f });
    m_modeLabel->setPosition({ 63.f, H - 36.f });
    m_mainLayer->addChild(m_modeLabel);

    auto hub = ui::button("Open GDSR", ui::Style::Dark, 70.f, 17.f, this, menu_selector(SubmitPopup::onOpenHub), .28f);
    hub->setPosition({ 63.f + title->getScaledContentSize().width + 8.f + 35.f, H - 21.f });
    m_buttonMenu->addChild(hub);

    m_accountNode = CCNode::create();
    m_accountNode->setPosition({ W - 16.f, H - 28.f });
    m_mainLayer->addChild(m_accountNode);

    m_accountMenu = CCMenu::create();
    m_accountMenu->setPosition({ 0, 0 });
    m_accountMenu->setContentSize({ 0, 0 });
    m_accountNode->addChild(m_accountMenu);
}

static NineSlice* makeCard(CCNode* parent, float x) {
    auto card = ui::surface("card.png"_spr, { CARD_W, CARD_H });
    card->setAnchorPoint({ 0.f, 1.f });
    card->setPosition({ x, CARD_TOP });
    parent->addChild(card);
    return card;
}

static CCMenuItemToggler* makeTick(CCObject* target, SEL_MenuHandler sel) {
    auto off = CCSprite::create("tick_off.png"_spr);
    auto on = CCSprite::create("tick_on.png"_spr);
    float scale = 15.f / off->getContentSize().width;
    off->setScale(scale);
    on->setScale(scale);
    return CCMenuItemToggler::create(off, on, target, sel);
}

void SubmitPopup::buildLevelCard() {
    m_levelCard = makeCard(m_mainLayer, 14.f);
    auto lvl = m_level.data();

    auto head = ui::label("LEVEL", "bigFont.fnt", .32f, ui::MUTED);
    head->setAnchorPoint({ 0.f, .5f });
    head->setPosition({ 34.f, CARD_H - 15.f });
    m_levelCard->addChild(head);

    auto name = ui::fitLabel(std::string(lvl->m_levelName), "bigFont.fnt", .5f, ui::TEXT, CARD_W - 24.f);
    name->setAnchorPoint({ 0.f, .5f });
    name->setPosition({ 12.f, CARD_H - 37.f });
    m_levelCard->addChild(name);

    std::string diff = levelDifficultyName(lvl);
    int stars = lvl->m_stars.value();
    std::string meta = fmt::format("ID {}{}{}", lvl->m_levelID.value(), diff.empty() ? "" : "  -  " + diff, stars > 0 ? fmt::format("  -  {}*", stars) : "");
    auto metaLbl = ui::fitLabel(meta, "chatFont.fnt", .62f, ui::MUTED, CARD_W - 24.f);
    metaLbl->setAnchorPoint({ 0.f, .5f });
    metaLbl->setPosition({ 12.f, CARD_H - 56.f });
    m_levelCard->addChild(metaLbl);

    std::string len = levelLengthText(lvl, m_exactLength);
    auto by = ui::fitLabel(fmt::format("by {}{}", std::string(lvl->m_creatorName).empty() ? "Unknown" : std::string(lvl->m_creatorName), len.empty() ? "" : "  -  " + len),
        "chatFont.fnt", .62f, ui::MUTED, CARD_W - 24.f);
    by->setAnchorPoint({ 0.f, .5f });
    by->setPosition({ 12.f, CARD_H - 71.f });
    m_levelCard->addChild(by);

    m_levelStatus = ui::label("", "chatFont.fnt", .62f, ui::FAINT);
    m_levelStatus->setAnchorPoint({ 0.f, .5f });
    m_levelStatus->setPosition({ 12.f, 15.f });
    m_levelCard->addChild(m_levelStatus);

    auto menu = CCMenu::create();
    menu->setPosition({ 0, 0 });
    m_levelCard->addChild(menu);
    m_levelTick = makeTick(this, menu_selector(SubmitPopup::onLevelTick));
    m_levelTick->setPosition({ 20.f, CARD_H - 15.f });
    menu->addChild(m_levelTick);
}

void SubmitPopup::buildSongCard() {
    m_songCard = makeCard(m_mainLayer, W - 14.f - CARD_W);

    auto head = ui::label("SONG", "bigFont.fnt", .32f, ui::MUTED);
    head->setAnchorPoint({ 0.f, .5f });
    head->setPosition({ 34.f, CARD_H - 15.f });
    m_songCard->addChild(head);

    std::string title = m_audio.name.empty() ? (m_audio.songID > 0 ? fmt::format("Song {}", m_audio.songID) : "Unknown song") : m_audio.name;
    auto name = ui::fitLabel(title, "bigFont.fnt", .5f, ui::TEXT, CARD_W - 24.f);
    name->setAnchorPoint({ 0.f, .5f });
    name->setPosition({ 12.f, CARD_H - 37.f });
    m_songCard->addChild(name);

    std::string meta = m_audio.artist.empty() ? originLabel(m_audio.origin) : fmt::format("{}  -  {}", m_audio.artist, originLabel(m_audio.origin));
    auto metaLbl = ui::fitLabel(meta, "chatFont.fnt", .62f, ui::MUTED, CARD_W - 24.f);
    metaLbl->setAnchorPoint({ 0.f, .5f });
    metaLbl->setPosition({ 12.f, CARD_H - 56.f });
    m_songCard->addChild(metaLbl);

    std::string meta2 = m_audio.songID > 0 ? fmt::format("Song ID {}", m_audio.songID) : "No song ID (built-in song)";
    if (m_audio.readable && m_audio.size) meta2 += "  -  " + formatBytes(m_audio.size);
    auto meta2Lbl = ui::fitLabel(meta2, "chatFont.fnt", .62f, ui::MUTED, CARD_W - 24.f);
    meta2Lbl->setAnchorPoint({ 0.f, .5f });
    meta2Lbl->setPosition({ 12.f, CARD_H - 71.f });
    m_songCard->addChild(meta2Lbl);

    m_songStatus = ui::label("", "chatFont.fnt", .62f, ui::FAINT);
    m_songStatus->setAnchorPoint({ 0.f, .5f });
    m_songStatus->setPosition({ 12.f, 15.f });
    m_songCard->addChild(m_songStatus);

    auto menu = CCMenu::create();
    menu->setPosition({ 0, 0 });
    m_songCard->addChild(menu);
    m_songTick = makeTick(this, menu_selector(SubmitPopup::onSongTick));
    m_songTick->setPosition({ 20.f, CARD_H - 15.f });
    menu->addChild(m_songTick);
}

void SubmitPopup::buildSongFields() {
    float y = 104.f;
    m_typeTitle = ui::label("TYPE", "bigFont.fnt", .3f, ui::MUTED);
    m_typeTitle->setAnchorPoint({ 0.f, .5f });
    m_typeTitle->setPosition({ 16.f, y });
    m_mainLayer->addChild(m_typeTitle);

    for (int i = 0; i < TYPE_N; i++) {
        auto btn = ui::button(TYPE_NAMES[i], ui::Style::Dark, 62.f, 22.f, this, menu_selector(SubmitPopup::onType), .32f);
        btn->setTag(i);
        btn->setPosition({ 86.f + i * 66.f, y });
        m_buttonMenu->addChild(btn);
        m_typeButtons.push_back(btn);
    }

    float iy = 72.f;
    m_nameInput = TextInput::create(186.f, "Song name", "chatFont.fnt");
    m_nameInput->setCommonFilter(CommonFilter::Any);
    m_nameInput->setMaxCharCount(120);
    m_nameInput->setPosition({ 14.f + 93.f, iy });
    m_nameInput->setString(m_audio.name);
    m_mainLayer->addChild(m_nameInput);

    m_authorInput = TextInput::create(186.f, "Author (who made it)", "chatFont.fnt");
    m_authorInput->setCommonFilter(CommonFilter::Any);
    m_authorInput->setMaxCharCount(120);
    m_authorInput->setPosition({ W - 14.f - 93.f, iy });
    m_authorInput->setString(m_audio.artist);
    m_mainLayer->addChild(m_authorInput);

    m_songBInput = TextInput::create(186.f, "Song B (second song)", "chatFont.fnt");
    m_songBInput->setCommonFilter(CommonFilter::Any);
    m_songBInput->setMaxCharCount(120);
    m_songBInput->setPosition({ W - 14.f - 93.f, iy });
    m_songBInput->setVisible(false);
    m_mainLayer->addChild(m_songBInput);
}

void SubmitPopup::buildFooter() {
    auto line = ui::rect(W - 28.f, 1.f, { 29, 43, 35 });
    line->setPosition({ W / 2, 46.f });
    m_mainLayer->addChild(line);

    m_status = ui::label("", "chatFont.fnt", .65f, ui::MUTED);
    m_status->setAnchorPoint({ 0.f, .5f });
    m_status->setPosition({ 16.f, 25.f });
    m_mainLayer->addChild(m_status);

    m_spinner = LoadingSpinner::create(16.f);
    m_spinner->setPosition({ W - 172.f, 25.f });
    m_spinner->setVisible(false);
    m_mainLayer->addChild(m_spinner);

    m_submit = ui::button("Send request", ui::Style::Primary, 136.f, 28.f, this, menu_selector(SubmitPopup::onSubmit), .42f);
    m_submit->setPosition({ W - 16.f - 68.f, 25.f });
    m_buttonMenu->addChild(m_submit);
}

void SubmitPopup::refreshAccount() {
    m_accountNode->removeAllChildren();
    m_accountMenu = CCMenu::create();
    m_accountMenu->setPosition({ 0, 0 });
    m_accountNode->addChild(m_accountMenu);

    bool admin = signedIn() && session().isAdmin;
    m_modeLabel->setString(!signedIn() ? "Sign in to request songs and levels" : admin ? "Admin  -  adds go straight to GDSR" : "Requests are reviewed by admins");

    if (!signedIn()) {
        auto btn = ui::button("Sign in", ui::Style::Primary, 74.f, 24.f, this, menu_selector(SubmitPopup::onSignIn), .4f);
        btn->setPosition({ -37.f, 3.f });
        m_accountMenu->addChild(btn);
        return;
    }

    auto name = ui::fitLabel(displayName(), "bigFont.fnt", .36f, ui::TEXT, 120.f);
    name->setAnchorPoint({ 1.f, .5f });
    name->setPosition({ admin ? -36.f : 0.f, 8.f });
    m_accountNode->addChild(name);

    if (admin) {
        auto txt = ui::label("ADMIN", "bigFont.fnt", .26f, ui::ACCENT);
        txt->setAnchorPoint({ 1.f, .5f });
        txt->setPosition({ 0.f, 8.f });
        m_accountNode->addChild(txt);
    }

    auto out = CCMenuItemSpriteExtra::create(ui::label("Sign out", "chatFont.fnt", .6f, ui::FAINT), this, menu_selector(SubmitPopup::onSignOut));
    out->setAnchorPoint({ 1.f, .5f });
    out->setPosition({ 0.f, -7.f });
    m_accountMenu->addChild(out);
}

void SubmitPopup::refreshCards() {
    bool admin = signedIn() && session().isAdmin;
    bool levelBlocked = m_remote.levelExists || m_remote.levelRequested;
    if (levelBlocked) m_wantLevel = false;
    m_levelTick->toggle(m_wantLevel);
    m_levelTick->setEnabled(!levelBlocked);
    m_levelTick->setVisible(!levelBlocked);
    if (!signedIn()) { m_levelStatus->setString("Sign in to check GDSR"); m_levelStatus->setColor(ui::FAINT); }
    else if (!m_remoteLoaded) { m_levelStatus->setString("Checking GDSR..."); m_levelStatus->setColor(ui::FAINT); }
    else if (m_remote.levelExists) { m_levelStatus->setString("Already on GDSR"); m_levelStatus->setColor(ui::GOLD); }
    else if (m_remote.levelRequested) { m_levelStatus->setString("You already requested this level"); m_levelStatus->setColor(ui::GOLD); }
    else { m_levelStatus->setString(m_wantLevel ? (admin ? "Will be added" : "Will be requested") : "Not on GDSR yet"); m_levelStatus->setColor(m_wantLevel ? ui::ACCENT : ui::FAINT); }
    if (!m_audio.readable) m_wantSong = false;
    m_songTick->toggle(m_wantSong);
    m_songTick->setEnabled(m_audio.readable);
    m_songTick->setVisible(m_audio.readable);
    std::string songStatus; ccColor3B songColor = ui::FAINT;
    if (!m_audio.readable) { songStatus = m_audio.problem; songColor = ui::DANGER; }
    else if (!m_remoteLoaded || m_audio.songID <= 0) { songStatus = m_wantSong ? "Audio will be uploaded" : "Not selected"; songColor = m_wantSong ? ui::ACCENT : ui::FAINT; }
    else {
        songStatus = m_remote.songCount == 0 ? "No songs on this ID yet" : fmt::format("{} song{} on this ID", m_remote.songCount, m_remote.songCount == 1 ? "" : "s");
        songColor = m_wantSong ? ui::ACCENT : ui::FAINT;
    }
    auto max = CARD_W - 24.f;
    m_songStatus->setString(songStatus.c_str());
    m_songStatus->setColor(songColor);
    m_songStatus->setScale(.62f);
    if (m_songStatus->getContentSize().width * .62f > max) m_songStatus->setScale(max / m_songStatus->getContentSize().width);
    m_levelStatus->setScale(.62f);
    if (m_levelStatus->getContentSize().width * .62f > max) m_levelStatus->setScale(max / m_levelStatus->getContentSize().width);

    m_levelCard->setColor(m_wantLevel ? ccColor3B{ 200, 255, 225 } : ccColor3B{ 255, 255, 255 });
    m_songCard->setColor(m_wantSong ? ccColor3B{ 200, 255, 225 } : ccColor3B{ 255, 255, 255 });
}

void SubmitPopup::refreshSongFields() {
    bool show = m_wantSong;
    m_typeTitle->setVisible(show);
    for (int i = 0; i < TYPE_N; i++) {
        bool on = m_type == TYPE_KEYS[i];
        ui::setButtonText(m_typeButtons[i], TYPE_NAMES[i], on ? ui::Style::Primary : ui::Style::Dark, 62.f, 22.f, .32f);
        m_typeButtons[i]->setVisible(show);
        m_typeButtons[i]->setEnabled(show);
    }
    m_nameInput->setVisible(show);
    bool mashup = m_type == "mashup";
    m_authorInput->setVisible(show && !mashup);
    m_songBInput->setVisible(show && mashup);
}

void SubmitPopup::refreshSubmit() {
    bool admin = signedIn() && session().isAdmin;
    std::string text = !signedIn() ? "Sign in" : admin ? "Add to GDSR" : "Send request";
    ui::setButtonText(m_submit, text, ui::Style::Primary, 136.f, 28.f, .42f);
    bool can = !m_busy && (!signedIn() || m_wantLevel || m_wantSong);
    ui::setEnabled(m_submit, can);
    if (!m_busy && signedIn() && !m_wantLevel && !m_wantSong && m_remoteLoaded) {
        setStatus(m_audio.readable || !m_remote.levelExists ? "Pick the level, the song, or both." : "Nothing to send for this level.", ui::FAINT);
    }
}

void SubmitPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float max = W - 16.f - 136.f - 16.f - 26.f;
    m_status->setScale(.65f);
    if (m_status->getContentSize().width * .65f > max) m_status->setScale(std::max(.45f, max / m_status->getContentSize().width));
}

void SubmitPopup::setBusy(bool busy) {
    m_busy = busy;
    m_spinner->setVisible(busy);
    refreshSubmit();
}

void SubmitPopup::runChecks() {
    m_remoteLoaded = false;
    refreshCards();
    setStatus("Checking GDSR...", ui::FAINT);
    m_checkTask.spawn(fetchRemote(m_level->m_levelID.value(), m_audio.songID), [this](Result<RemoteState> result) {
        if (!result) {
            setStatus(result.unwrapErr(), ui::DANGER);
            if (!signedIn()) { refreshAccount(); refreshCards(); refreshSubmit(); }
            return;
        }
        m_remote = std::move(result).unwrap();
        m_remoteLoaded = true;
        refreshAccount();
        refreshCards();
        refreshSubmit();
        setStatus(m_wantLevel || m_wantSong ? "Ready." : "Nothing new to send.", ui::FAINT);
    });
}

void SubmitPopup::onLevelTick(CCObject*) {
    // the toggler flips its state after this callback runs
    m_wantLevel = !m_levelTick->isToggled();
    Ref<SubmitPopup> self = this;
    queueInMainThread([self] { self->refreshCards(); self->refreshSubmit(); });
}

void SubmitPopup::onSongTick(CCObject*) {
    m_wantSong = !m_songTick->isToggled();
    Ref<SubmitPopup> self = this;
    queueInMainThread([self] { self->refreshCards(); self->refreshSongFields(); self->refreshSubmit(); });
}

void SubmitPopup::onType(CCObject* sender) {
    int i = static_cast<CCNode*>(sender)->getTag();
    if (i < 0 || i >= TYPE_N) return;
    m_type = TYPE_KEYS[i];
    refreshSongFields();
    if (m_type == "mashup" && m_remoteLoaded && m_remote.originalSongUUID.empty()) {
        setStatus("Mashups need the original song on GDSR first.", ui::GOLD);
    } else {
        setStatus("", ui::FAINT);
    }
}

void SubmitPopup::onSignIn(CCObject*) {
    Ref<SubmitPopup> self = this;
    LoginPopup::create([self] {
        self->refreshAccount();
        self->refreshCards();
        self->refreshSubmit();
        self->runChecks();
    })->show();
}

void SubmitPopup::onSignOut(CCObject*) {
    signOut();
    m_remote = RemoteState{};
    m_remoteLoaded = false;
    m_wantLevel = true;
    refreshAccount();
    refreshCards();
    refreshSubmit();
    setStatus("Signed out.", ui::FAINT);
}

void SubmitPopup::onOpenHub(CCObject*) {
    if (auto popup = HubPopup::create(0)) popup->show();
}

void SubmitPopup::onSubmit(CCObject*) {
    if (m_busy) return;
    if (!signedIn()) { onSignIn(nullptr); return; }
    if (!m_wantLevel && !m_wantSong) { setStatus("Pick the level, the song, or both.", ui::GOLD); return; }

    auto lvl = m_level.data();
    SubmitJob job;
    job.admin = session().isAdmin;
    job.sendLevel = m_wantLevel && !m_remote.levelExists && !m_remote.levelRequested;
    job.sendSong = m_wantSong && m_audio.readable;
    job.levelName = std::string(lvl->m_levelName);
    job.levelID = lvl->m_levelID.value();
    job.creators = std::string(lvl->m_creatorName);
    job.length = levelLengthText(lvl, m_exactLength);
    job.difficulty = levelDifficultyName(lvl);
    job.stars = lvl->m_stars.value();
    job.songID = m_audio.songID;

    if (job.sendSong) {
        job.songName = utils::string::trim(std::string(m_nameInput->getString()));
        job.type = m_type;
        if (job.songName.empty()) { setStatus("Give the song a name.", ui::DANGER); m_nameInput->focus(); return; }
        if (m_type == "mashup") {
            job.songBName = utils::string::trim(std::string(m_songBInput->getString()));
            job.songA = m_remote.originalSongUUID;
            if (job.songA.empty()) { setStatus("Mashups need the original song on GDSR first.", ui::DANGER); return; }
            if (job.songBName.empty()) { setStatus("Type the name of Song B.", ui::DANGER); m_songBInput->focus(); return; }
        } else {
            job.author = utils::string::trim(std::string(m_authorInput->getString()));
        }
        auto lower = utils::string::toLower(job.songName);
        for (auto const& existing : m_remote.songNames) {
            if (existing == lower) { setStatus("A song with this name is already on this song ID.", ui::DANGER); return; }
        }

        auto data = readAudio(m_audio);
        if (!data) { setStatus(data.unwrapErr(), ui::DANGER); return; }
        if (data.unwrap().size() > MAX_AUDIO_BYTES) { setStatus(fmt::format("The audio is {}, the limit is 20 MB.", formatBytes(data.unwrap().size())), ui::DANGER); return; }
        job.audio = std::move(data).unwrap();
        if (auto secs = audioDurationSeconds(job.audio)) job.songLength = mmss(secs);
        job.fileName = m_audio.fileName;
        job.mime = mimeFor(m_audio.fileName);
    }

    if (!job.sendLevel && !job.sendSong) { setStatus("Nothing new to send.", ui::GOLD); return; }

    setBusy(true);
    setStatus(job.sendSong ? "Uploading audio..." : "Sending...", ui::MUTED);
    m_submitTask.spawn(runSubmit(std::move(job)), [this](Result<std::string> result) {
        setBusy(false);
        if (!result) {
            setStatus(result.unwrapErr(), ui::DANGER);
            return;
        }
        auto summary = result.unwrap();
        Notification::create(summary.empty() ? "Sent to GDSR" : summary, NotificationIcon::Success)->show();
        setStatus(summary + ".", ui::ACCENT);
        // re-check so the cards show the new state (and you can't send twice)
        if (m_wantSong) m_wantSong = false;
        refreshSongFields();
        runChecks();
    });
}

}
