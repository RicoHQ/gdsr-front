#include "HubPopup.hpp"
#include "SongPopup.hpp"
#include "GuessPopup.hpp"
#include "LoginPopup.hpp"
#include "AfkPopup.hpp"
#include "Theme.hpp"
#include "../audio/Player.hpp"
#include "../Config.hpp"

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 440.f;
static constexpr float H = 290.f;
static constexpr float CONTENT_TOP = H - 70.f;
static constexpr float CONTENT_BOTTOM = 52.f;
static constexpr float ROW_W = W - 32.f;

static char const* DIFF_SHORT[] = { "Auto", "Easy", "Normal", "Hard", "Harder", "Insane", "Easy D.", "Med. D.", "Hard D.", "Ins. D.", "Ext. D." };

HubPopup* HubPopup::create(int startTab) {
    auto ret = new HubPopup();
    if (ret->init(startTab)) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool HubPopup::init(int startTab) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_guess = GuessConfig::load();
    buildHeader();
    buildFooter();
    refreshAccount();

    Ref<HubPopup> self = this;
    Player::get()->setListener(this, [self] { self->onPlayer(); });
    onPlayer();
    this->scheduleUpdate();

    m_tab = startTab == 1 ? Tab::Requests : startTab == 2 ? Tab::Guess : Tab::Songs;
    refreshTabs();
    if (catalog().loaded) showTab(m_tab);
    else { showTab(m_tab); loadCatalog(true); }
    return true;
}

// rows clipped out of view must not take taps
void HubPopup::update(float) {
    if (!m_scroll) return;
    auto origin = m_scroll->convertToWorldSpace({ 0, 0 });
    auto top = m_scroll->convertToWorldSpace({ 0, m_scroll->getContentSize().height });
    for (auto row : CCArrayExt<CCNode*>(m_scroll->m_contentLayer->getChildren())) {
        for (auto child : CCArrayExt<CCNode*>(row->getChildren())) {
            auto menu = typeinfo_cast<CCMenu*>(child);
            if (!menu) continue;
            for (auto item : CCArrayExt<CCNode*>(menu->getChildren())) {
                auto btn = typeinfo_cast<CCMenuItem*>(item);
                if (!btn || btn->getUserObject("gdsr-off")) continue;
                auto p = menu->convertToWorldSpace(item->getPosition());
                bool inside = p.y > origin.y + 2.f && p.y < top.y - 2.f;
                if (btn->isEnabled() != inside) btn->setEnabled(inside);
            }
        }
    }
}

void HubPopup::onClose(CCObject* sender) {
    Player::get()->clearListener(this);
    Popup::onClose(sender);
}
void HubPopup::buildHeader() {
    auto logo = CCSprite::create("side_btn.png"_spr);
    logo->setScale(22.f / logo->getContentSize().width);
    logo->setPosition({ 46.f, H - 25.f });
    m_mainLayer->addChild(logo);

    auto title = ui::label("GDSR", "bigFont.fnt", .62f, ui::TEXT);
    title->setAnchorPoint({ 0.f, .5f });
    title->setPosition({ 63.f, H - 21.f });
    m_mainLayer->addChild(title);

    m_modeLabel = ui::label("Geometry Dash song ratings", "chatFont.fnt", .62f, ui::MUTED);
    m_modeLabel->setAnchorPoint({ 0.f, .5f });
    m_modeLabel->setPosition({ 63.f, H - 36.f });
    m_mainLayer->addChild(m_modeLabel);

    m_accountNode = CCNode::create();
    m_accountNode->setPosition({ W - 16.f, H - 28.f });
    m_mainLayer->addChild(m_accountNode);

    static char const* names[] = { "Songs", "Requests", "Guess" };
    for (int i = 0; i < 3; i++) {
        auto btn = ui::toggle(names[i], i == 0, 96.f, 22.f, this, menu_selector(HubPopup::onTab), .38f);
        btn->setTag(i);
        btn->setPosition({ 16.f + 48.f + i * 102.f, H - 56.f });
        m_buttonMenu->addChild(btn);
        m_tabButtons.push_back(btn);
    }

    auto site = ui::button("Website", ui::Style::Dark, 64.f, 22.f, this, menu_selector(HubPopup::onSite), .32f);
    site->setPosition({ W - 16.f - 32.f - 28.f, H - 56.f });
    m_buttonMenu->addChild(site);

    auto refresh = ui::iconButton("ic_refresh.png"_spr, ui::Style::Dark, 22.f, this, menu_selector(HubPopup::onRefresh));
    refresh->setPosition({ W - 16.f - 11.f, H - 56.f });
    m_buttonMenu->addChild(refresh);

    m_spinner = LoadingSpinner::create(22.f);
    m_spinner->setPosition({ W / 2, (CONTENT_TOP + CONTENT_BOTTOM) / 2 });
    m_spinner->setVisible(false);
    m_mainLayer->addChild(m_spinner, 5);
}

void HubPopup::buildFooter() {
    auto line = ui::rect(W - 28.f, 1.f, { 29, 43, 35 });
    line->setPosition({ W / 2, 44.f });
    m_mainLayer->addChild(line);

    m_playBtn = ui::iconButton("ic_play.png"_spr, ui::Style::Primary, 24.f, this, menu_selector(HubPopup::onPlayPause));
    m_playBtn->setPosition({ 30.f, 24.f });
    m_buttonMenu->addChild(m_playBtn);

    m_stopBtn = ui::iconButton("ic_stop.png"_spr, ui::Style::Dark, 24.f, this, menu_selector(HubPopup::onStop));
    m_stopBtn->setPosition({ 58.f, 24.f });
    m_buttonMenu->addChild(m_stopBtn);
    ui::setEnabled(m_playBtn, false);
    ui::setEnabled(m_stopBtn, false);

    m_nowLabel = ui::label("Nothing playing", "chatFont.fnt", .62f, ui::FAINT);
    m_nowLabel->setAnchorPoint({ 0.f, .5f });
    m_nowLabel->setPosition({ 78.f, 29.f });
    m_mainLayer->addChild(m_nowLabel);

    m_progressBg = ui::rect(W - 94.f, 3.f, { 29, 43, 35 });
    m_progressBg->setAnchorPoint({ 0.f, .5f });
    m_progressBg->setPosition({ 78.f, 17.f });
    m_mainLayer->addChild(m_progressBg);

    m_progress = ui::rect(0.f, 3.f, ui::ACCENT);
    m_progress->setAnchorPoint({ 0.f, .5f });
    m_progress->setPosition({ 78.f, 17.f });
    m_mainLayer->addChild(m_progress);

    m_status = ui::label("", "chatFont.fnt", .6f, ui::MUTED);
    m_status->setPosition({ W / 2, (CONTENT_TOP + CONTENT_BOTTOM) / 2 - 24.f });
    m_mainLayer->addChild(m_status, 5);
}

void HubPopup::refreshAccount() {
    m_accountNode->removeAllChildren();
    auto menu = CCMenu::create();
    menu->setPosition({ 0, 0 });
    m_accountNode->addChild(menu);

    if (!signedIn()) {
        auto btn = ui::button("Sign in", ui::Style::Primary, 74.f, 24.f, this, menu_selector(HubPopup::onSignIn), .4f);
        btn->setPosition({ -37.f, 3.f });
        menu->addChild(btn);
        return;
    }
    bool admin = session().isAdmin;
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
    auto out = CCMenuItemSpriteExtra::create(ui::label("Sign out", "chatFont.fnt", .6f, ui::FAINT), this, menu_selector(HubPopup::onSignOut));
    out->setAnchorPoint({ 1.f, .5f });
    out->setPosition({ 0.f, -7.f });
    menu->addChild(out);
}

void HubPopup::refreshTabs() {
    static char const* names[] = { "Songs", "Requests", "Guess" };
    for (int i = 0; i < 3; i++) ui::setToggle(m_tabButtons[i], names[i], static_cast<int>(m_tab) == i, 96.f, 22.f, .38f);
}

void HubPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float max = W - 40.f;
    m_status->setScale(.6f);
    if (m_status->getContentSize().width * .6f > max) m_status->setScale(max / m_status->getContentSize().width);
}

void HubPopup::setLoading(bool on) {
    m_spinner->setVisible(on);
}

void HubPopup::clearContent() {
    if (m_content) m_content->removeFromParent();
    m_content = CCNode::create();
    m_content->setContentSize({ W, H });
    m_mainLayer->addChild(m_content, 2);
    m_contentMenu = CCMenu::create();
    m_contentMenu->setPosition({ 0, 0 });
    m_content->addChild(m_contentMenu, 3);
    m_scroll = nullptr;
    m_poolLabel = nullptr;
    m_startBtn = nullptr;
    setStatus("", ui::MUTED);
}

void HubPopup::showTab(Tab tab) {
    m_tab = tab;
    refreshTabs();
    clearContent();
    switch (tab) {
        case Tab::Songs: buildSongs(); break;
        case Tab::Requests: buildRequests(); break;
        case Tab::Guess: buildGuess(); break;
    }
}

CCNode* HubPopup::makeScroll(float height, float contentHeight) {
    m_scroll = ScrollLayer::create(CCSize{ ROW_W, height });
    m_scroll->setPosition({ 16.f, CONTENT_BOTTOM });
    // a drag that starts on a row scrolls the list instead of tapping the row
    m_scroll->setStealingTouches(true);
    m_scroll->setCancelTouchLimit(6.f);
    float total = std::max(height, contentHeight);
    m_scroll->m_contentLayer->setContentSize({ ROW_W, total });
    m_content->addChild(m_scroll, 1);
    m_scroll->scrollToTop();
    return m_scroll->m_contentLayer;
}

// ScrollLayer hides content-layer children by their bounds, so each row needs
// to be its own child with its own menu.
static CCNode* makeRow(CCNode* layer, float y, float height, CCMenu** menuOut) {
    auto row = CCNode::create();
    row->setContentSize({ ROW_W, height });
    row->setAnchorPoint({ 0.f, 0.f });
    row->ignoreAnchorPointForPosition(false);
    row->setPosition({ 0.f, y - height / 2 });
    layer->addChild(row);
    auto menu = CCMenu::create();
    menu->setPosition({ 0.f, 0.f });
    menu->setContentSize({ ROW_W, height });
    menu->ignoreAnchorPointForPosition(true);
    row->addChild(menu, 2);
    *menuOut = menu;
    return row;
}
void HubPopup::buildSongs() {
    float x = 16.f;
    std::vector<std::pair<std::string, std::string>> filters = { { "", "All" } };
    for (int i = 0; i < TYPE_COUNT; i++) filters.push_back({ TYPE_KEYS_ALL[i], TYPE_PLURALS[i] });
    for (size_t i = 0; i < filters.size(); i++) {
        auto btn = ui::toggle(filters[i].second, m_typeFilter == filters[i].first, 62.f, 18.f, this, menu_selector(HubPopup::onFilter), .3f);
        btn->setTag(static_cast<int>(i));
        btn->setPosition({ x + 31.f, CONTENT_TOP - 10.f });
        m_contentMenu->addChild(btn);
        x += 66.f;
    }
    if (!catalog().loaded) return;

    auto list = catalog().ranked(m_typeFilter);
    if (list.empty()) { setStatus(catalog().songs.empty() ? "No songs on GDSR yet." : "No songs of this type yet.", ui::FAINT); return; }

    float rowH = 30.f, gap = 3.f;
    float viewH = CONTENT_TOP - 24.f - CONTENT_BOTTOM;
    auto layer = makeScroll(viewH, list.size() * (rowH + gap));
    float total = layer->getContentSize().height;

    auto playing = Player::get()->active() ? Player::get()->id() : std::string();
    for (size_t i = 0; i < list.size(); i++) {
        auto s = list[i];
        float yc = total - i * (rowH + gap) - rowH / 2;
        bool isPlaying = playing == s->id;
        CCMenu* menu = nullptr;
        auto rowNode = makeRow(layer, yc, rowH, &menu);
        float y = rowH / 2;

        auto node = CCNode::create();
        node->setContentSize({ ROW_W - 40.f, rowH });
        auto bg = ui::card({ ROW_W - 40.f, rowH }, isPlaying);
        bg->setPosition({ (ROW_W - 40.f) / 2, rowH / 2 });
        node->addChild(bg);

        auto rank = ui::label(fmt::format("{}", i + 1), "bigFont.fnt", .3f, i < 3 ? ui::GOLD : ui::FAINT);
        rank->setPosition({ 14.f, rowH / 2 });
        node->addChild(rank);

        auto name = ui::fitLabel(s->name, "bigFont.fnt", .34f, ui::TEXT, ROW_W - 40.f - 100.f);
        name->setAnchorPoint({ 0.f, .5f });
        name->setPosition({ 28.f, rowH / 2 + 5.f });
        node->addChild(name);

        auto subText = fmt::format("{}{}", s->author.empty() ? "" : s->author + "  -  ", typeLabel(s->type));
        if (s->songID) subText += fmt::format("  -  ID {}", s->songID);
        auto sub = ui::fitLabel(subText, "chatFont.fnt", .5f, ui::MUTED, ROW_W - 40.f - 100.f);
        sub->setAnchorPoint({ 0.f, .5f });
        sub->setPosition({ 28.f, rowH / 2 - 6.f });
        node->addChild(sub);

        auto score = catalog().overall(*s);
        auto scoreLbl = ui::label(scoreText(score), "bigFont.fnt", .36f, scoreColor(score));
        scoreLbl->setAnchorPoint({ 1.f, .5f });
        scoreLbl->setPosition({ ROW_W - 40.f - 10.f, rowH / 2 + 3.f });
        node->addChild(scoreLbl);
        auto votes = ui::label(fmt::format("{} vote{}", s->votes, s->votes == 1 ? "" : "s"), "chatFont.fnt", .45f, ui::FAINT);
        votes->setAnchorPoint({ 1.f, .5f });
        votes->setPosition({ ROW_W - 40.f - 10.f, rowH / 2 - 8.f });
        node->addChild(votes);

        auto row = CCMenuItemSpriteExtra::create(node, this, menu_selector(HubPopup::onSongRow));
        row->setUserObject(CCString::create(s->id));
        row->m_scaleMultiplier = 1.02f;
        row->setPosition({ (ROW_W - 40.f) / 2, y });
        menu->addChild(row);

        auto play = ui::iconButton(isPlaying && !Player::get()->paused() ? "ic_pause.png"_spr : "ic_play.png"_spr,
            s->audioFile.empty() ? ui::Style::Dark : ui::Style::Primary, 26.f, this, menu_selector(HubPopup::onSongPlay));
        play->setUserObject(CCString::create(s->id));
        play->setPosition({ ROW_W - 16.f, y });
        if (s->audioFile.empty()) { ui::setEnabled(play, false); play->setUserObject("gdsr-off", CCBool::create(true)); }
        menu->addChild(play);
        (void)rowNode;
    }
}

void HubPopup::onFilter(CCObject* sender) {
    int i = static_cast<CCNode*>(sender)->getTag();
    m_typeFilter = i <= 0 || i > TYPE_COUNT ? "" : TYPE_KEYS_ALL[i - 1];
    showTab(Tab::Songs);
}

static std::string tagString(CCObject* sender) {
    auto node = static_cast<CCNode*>(sender);
    if (auto s = typeinfo_cast<CCString*>(node->getUserObject())) return s->getCString();
    return "";
}

void HubPopup::onSongRow(CCObject* sender) {
    auto id = tagString(sender);
    Ref<HubPopup> self = this;
    if (auto popup = SongPopup::create(id, [self] {
        if (self->m_tab == Tab::Songs) self->showTab(Tab::Songs);
    })) popup->show();
}

void HubPopup::onSongPlay(CCObject* sender) {
    auto id = tagString(sender);
    auto player = Player::get();
    if (player->active() && player->id() == id) { player->togglePause(); return; }
    playSong(id);
}

void HubPopup::playSong(std::string songUUID) {
    auto s = catalog().byId(songUUID);
    if (!s || s->audioFile.empty()) { setStatus("This song has no audio uploaded yet.", ui::GOLD); return; }
    std::string title = s->name + (s->author.empty() ? "" : "  -  " + s->author);
    m_nowLabel->setString("Loading...");
    m_nowLabel->setColor(ui::MUTED);
    m_audioTask.spawn(fetchAudio(s->audioFile), [this, songUUID, title](Result<std::filesystem::path> res) {
        if (!res) { setStatus(res.unwrapErr(), ui::DANGER); onPlayer(); return; }
        auto played = Player::get()->play(res.unwrap(), songUUID, title);
        if (!played) setStatus(played.unwrapErr(), ui::DANGER);
    });
}

void HubPopup::onPlayer() {
    auto player = Player::get();
    bool active = player->active();
    std::string key = active ? player->id() + (player->paused() ? "|p" : "") : "";
    bool changed = key != m_lastPlaying;
    if (changed) {
        ui::setIcon(m_playBtn, active && !player->paused() ? "ic_pause.png"_spr : "ic_play.png"_spr, ui::Style::Primary, 24.f);
        ui::setEnabled(m_playBtn, active);
        ui::setEnabled(m_stopBtn, active);
    }
    if (active) {
        auto txt = player->title();
        m_nowLabel->setString(txt.c_str());
        m_nowLabel->setColor(ui::TEXT);
        float max = W - 100.f;
        m_nowLabel->setScale(.62f);
        if (m_nowLabel->getContentSize().width * .62f > max) m_nowLabel->setScale(max / m_nowLabel->getContentSize().width);
    } else if (std::string(m_nowLabel->getString()) != "Loading...") {
        m_nowLabel->setString("Nothing playing");
        m_nowLabel->setColor(ui::FAINT);
        m_nowLabel->setScale(.62f);
    }
    ui::sizeRect(m_progress, (W - 94.f) * player->progress(), 3.f);

    if (changed) {
        m_lastPlaying = key;
        if (m_tab == Tab::Songs && catalog().loaded) {
            float y = m_scroll ? m_scroll->m_contentLayer->getPositionY() : 0.f;
            bool had = m_scroll != nullptr;
            showTab(Tab::Songs);
            if (had && m_scroll) m_scroll->m_contentLayer->setPositionY(y);
        }
    }
}

void HubPopup::onPlayPause(CCObject*) { Player::get()->togglePause(); }
void HubPopup::onStop(CCObject*) { Player::get()->stop(); }
void HubPopup::buildRequests() {
    if (!signedIn()) {
        auto msg = ui::label("Sign in to see your requests.", "chatFont.fnt", .7f, ui::MUTED);
        msg->setPosition({ W / 2, (CONTENT_TOP + CONTENT_BOTTOM) / 2 + 14.f });
        m_content->addChild(msg);
        auto btn = ui::button("Sign in", ui::Style::Primary, 96.f, 26.f, this, menu_selector(HubPopup::onSignIn), .42f);
        btn->setPosition({ W / 2, (CONTENT_TOP + CONTENT_BOTTOM) / 2 - 16.f });
        m_contentMenu->addChild(btn);
        return;
    }
    bool admin = session().isAdmin;
    bool queue = admin && !m_showMine;

    auto head = ui::label(queue ? "PENDING REQUESTS" : "YOUR REQUESTS", "bigFont.fnt", .3f, ui::MUTED);
    head->setAnchorPoint({ 0.f, .5f });
    head->setPosition({ 18.f, CONTENT_TOP - 10.f });
    m_content->addChild(head);

    if (admin) {
        auto btn = ui::button(m_showMine ? "Review queue" : "My requests", ui::Style::Dark, 90.f, 18.f, this, menu_selector(HubPopup::onToggleMine), .3f);
        btn->setPosition({ W - 16.f - 45.f, CONTENT_TOP - 10.f });
        m_contentMenu->addChild(btn);
        auto afk = ui::button("AFK Admin", ui::Style::Primary, 84.f, 18.f, this, menu_selector(HubPopup::onAfk), .3f);
        afk->setPosition({ W - 16.f - 90.f - 6.f - 42.f, CONTENT_TOP - 10.f });
        m_contentMenu->addChild(afk);
    }

    if (!m_requestsLoaded) { loadRequestsList(); return; }
    if (m_requests.empty()) {
        setStatus(queue ? "No pending requests. All caught up!" : "You haven't requested anything yet. Use the GDSR button on a level page.", ui::FAINT);
        return;
    }
    auto countLbl = ui::label(fmt::format("{}", m_requests.size()), "bigFont.fnt", .3f, ui::ACCENT);
    countLbl->setAnchorPoint({ 0.f, .5f });
    countLbl->setPosition({ 18.f + head->getScaledContentSize().width + 6.f, CONTENT_TOP - 10.f });
    m_content->addChild(countLbl);

    float rowH = 34.f, gap = 3.f;
    float viewH = CONTENT_TOP - 24.f - CONTENT_BOTTOM;
    auto layer = makeScroll(viewH, m_requests.size() * (rowH + gap));
    float total = layer->getContentSize().height;

    for (size_t i = 0; i < m_requests.size(); i++) {
        auto const& r = m_requests[i];
        float yc = total - i * (rowH + gap) - rowH / 2;
        CCMenu* menu = nullptr;
        auto rowNode = makeRow(layer, yc, rowH, &menu);
        float y = rowH / 2;

        auto bg = ui::card({ ROW_W, rowH });
        bg->setPosition({ ROW_W / 2, y });
        rowNode->addChild(bg);

        auto kind = ui::label(r.isSong ? "SONG" : "LEVEL", "bigFont.fnt", .24f, r.isSong ? ui::ACCENT : ui::GOLD);
        kind->setAnchorPoint({ 0.f, .5f });
        kind->setPosition({ 10.f, y + 8.f });
        rowNode->addChild(kind);

        float textW = queue ? ROW_W - 190.f : ROW_W - 120.f;
        auto name = ui::fitLabel(r.name, "bigFont.fnt", .34f, ui::TEXT, textW - 36.f);
        name->setAnchorPoint({ 0.f, .5f });
        name->setPosition({ 46.f, y + 7.f });
        rowNode->addChild(name);

        auto sub = ui::fitLabel(r.sub + "  -  " + r.created, "chatFont.fnt", .5f, ui::MUTED, textW);
        sub->setAnchorPoint({ 0.f, .5f });
        sub->setPosition({ 10.f, y - 8.f });
        rowNode->addChild(sub);

        if (queue) {
            if (r.isSong && !r.audioFile.empty()) {
                auto play = ui::iconButton("ic_play.png"_spr, ui::Style::Dark, 22.f, this, menu_selector(HubPopup::onRequestPlay));
                play->setTag(static_cast<int>(i));
                play->setPosition({ ROW_W - 150.f, y });
                menu->addChild(play);
            }
            auto ok = ui::button("Approve", ui::Style::Primary, 62.f, 22.f, this, menu_selector(HubPopup::onApprove), .3f);
            ok->setTag(static_cast<int>(i));
            ok->setPosition({ ROW_W - 103.f, y });
            menu->addChild(ok);
            auto no = ui::button("Reject", ui::Style::Danger, 56.f, 22.f, this, menu_selector(HubPopup::onReject), .3f);
            no->setTag(static_cast<int>(i));
            no->setPosition({ ROW_W - 36.f, y });
            menu->addChild(no);
        } else {
            ccColor3B color = r.status == "approved" ? ui::ACCENT : r.status == "rejected" ? ui::DANGER : ui::GOLD;
            std::string text = r.status.empty() ? "pending" : r.status;
            text[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(text[0])));
            auto st = ui::label(text, "bigFont.fnt", .3f, color);
            st->setAnchorPoint({ 1.f, .5f });
            st->setPosition({ ROW_W - 10.f, y + 6.f });
            rowNode->addChild(st);
            if (!r.note.empty()) {
                auto note = ui::fitLabel(r.note, "chatFont.fnt", .45f, ui::FAINT, 100.f);
                note->setAnchorPoint({ 1.f, .5f });
                note->setPosition({ ROW_W - 10.f, y - 8.f });
                rowNode->addChild(note);
            }
        }
    }
}

void HubPopup::loadRequestsList() {
    setLoading(true);
    bool queue = session().isAdmin && !m_showMine;
    m_requestsTask.spawn(loadRequests(queue), [this](Result<std::vector<Request>> res) {
        setLoading(false);
        if (!res) {
            if (!signedIn()) refreshAccount();
            if (m_tab == Tab::Requests) setStatus(res.unwrapErr(), ui::DANGER);
            return;
        }
        m_requests = std::move(res).unwrap();
        m_requestsLoaded = true;
        if (m_tab == Tab::Requests) showTab(Tab::Requests);
    });
}

void HubPopup::onAfk(CCObject*) {
    Ref<HubPopup> self = this;
    if (auto popup = AfkPopup::create([self] { self->loadCatalog(false); })) popup->show();
}

void HubPopup::onToggleMine(CCObject*) {
    m_showMine = !m_showMine;
    m_requestsLoaded = false;
    m_requests.clear();
    showTab(Tab::Requests);
}

void HubPopup::onRequestPlay(CCObject* sender) {
    int i = static_cast<CCNode*>(sender)->getTag();
    if (i < 0 || i >= static_cast<int>(m_requests.size())) return;
    playRequest(m_requests[i]);
}

void HubPopup::playRequest(Request const& req) {
    auto id = "request:" + req.id;
    if (Player::get()->active() && Player::get()->id() == id) { Player::get()->togglePause(); return; }
    std::string title = "Request: " + req.name;
    m_nowLabel->setString("Loading...");
    m_audioTask.spawn(fetchAudio(req.audioFile), [this, id, title](Result<std::filesystem::path> res) {
        if (!res) { setStatus(res.unwrapErr(), ui::DANGER); onPlayer(); return; }
        auto played = Player::get()->play(res.unwrap(), id, title);
        if (!played) setStatus(played.unwrapErr(), ui::DANGER);
    });
}

void HubPopup::onApprove(CCObject* sender) { review(static_cast<CCNode*>(sender)->getTag(), true); }
void HubPopup::onReject(CCObject* sender) { review(static_cast<CCNode*>(sender)->getTag(), false); }

void HubPopup::review(int index, bool approve) {
    if (index < 0 || index >= static_cast<int>(m_requests.size())) return;
    auto req = m_requests[index];
    setLoading(true);
    setStatus(approve ? "Approving..." : "Rejecting...", ui::MUTED);
    m_reviewTask.spawn(reviewRequest(req, approve), [this, req, approve](Result<> res) {
        setLoading(false);
        if (!res) { setStatus(res.unwrapErr(), ui::DANGER); return; }
        Notification::create(fmt::format("{} {}", approve ? "Approved" : "Rejected", req.name), approve ? NotificationIcon::Success : NotificationIcon::Info)->show();
        std::erase_if(m_requests, [&](Request const& r) { return r.id == req.id; });
        if (Player::get()->id() == "request:" + req.id) Player::get()->stop();
        if (m_tab == Tab::Requests) showTab(Tab::Requests);
        if (approve) loadCatalog(false);
    });
}
void HubPopup::buildGuess() {
    if (!catalog().loaded) return;
    float labelX = 18.f, x0 = 96.f;
    float y = CONTENT_TOP - 10.f;
    auto rowLabel = [&](char const* text, float yy) {
        auto l = ui::label(text, "bigFont.fnt", .28f, ui::MUTED);
        l->setAnchorPoint({ 0.f, .5f });
        l->setPosition({ labelX, yy });
        m_content->addChild(l);
    };

    rowLabel("SONG TYPES", y);
    for (int i = 0; i < TYPE_COUNT; i++) {
        bool on = std::find(m_guess.types.begin(), m_guess.types.end(), TYPE_KEYS_ALL[i]) != m_guess.types.end();
        auto b = ui::toggle(TYPE_PLURALS[i], on, 62.f, 18.f, this, menu_selector(HubPopup::onGuessType), .28f);
        b->setTag(i);
        b->setPosition({ x0 + 31.f + i * 66.f, y });
        m_contentMenu->addChild(b);
    }

    y -= 24.f;
    rowLabel("CLIP STARTS", y);
    {
        auto a = ui::toggle("From the start", !m_guess.randomStart, 128.f, 18.f, this, menu_selector(HubPopup::onGuessStart), .28f);
        a->setTag(0);
        a->setPosition({ x0 + 64.f, y });
        m_contentMenu->addChild(a);
        auto b = ui::toggle("Random part", m_guess.randomStart, 128.f, 18.f, this, menu_selector(HubPopup::onGuessStart), .28f);
        b->setTag(1);
        b->setPosition({ x0 + 64.f + 132.f, y });
        m_contentMenu->addChild(b);
    }

    y -= 24.f;
    rowLabel("LEVEL DIFF.", y);
    {
        for (int i = -1; i < DIFFICULTY_COUNT; i++) {
            int slot = i + 1;
            float bx = x0 + 27.f + (slot % 6) * 54.f;
            float by = y - (slot / 6) * 21.f;
            bool on = i < 0 ? m_guess.diffs.empty() : std::find(m_guess.diffs.begin(), m_guess.diffs.end(), DIFFICULTIES[i]) != m_guess.diffs.end();
            auto b = ui::toggle(i < 0 ? "Any" : DIFF_SHORT[i], on, 50.f, 18.f, this, menu_selector(HubPopup::onGuessDiff), .26f);
            b->setTag(i);
            b->setPosition({ bx, by });
            m_contentMenu->addChild(b);
        }
    }

    y -= 21.f + 25.f;
    rowLabel("GAME DIFF.", y);
    for (int i = 0; i < GUESS_LEVEL_COUNT; i++) {
        auto const& lv = GUESS_LEVELS[i];
        auto b = ui::toggle(fmt::format("{} {}", lv.label, clipText(lv.clip)), m_guess.level == i, 52.f, 20.f, this, menu_selector(HubPopup::onGuessLevel), .22f);
        b->setTag(i);
        b->setPosition({ x0 + 26.f + i * 55.f, y });
        m_contentMenu->addChild(b);
    }

    y -= 26.f;
    rowLabel("ROUNDS", y);
    static int const rounds[] = { 5, 10, 15, 20 };
    for (int i = 0; i < 4; i++) {
        auto b = ui::toggle(fmt::format("{}", rounds[i]), m_guess.rounds == rounds[i], 34.f, 18.f, this, menu_selector(HubPopup::onGuessRounds), .3f);
        b->setTag(rounds[i]);
        b->setPosition({ x0 + 17.f + i * 38.f, y });
        m_contentMenu->addChild(b);
    }

    m_poolLabel = ui::label("", "chatFont.fnt", .55f, ui::MUTED);
    m_poolLabel->setAnchorPoint({ 1.f, .5f });
    m_poolLabel->setPosition({ W - 16.f - 104.f, y });
    m_content->addChild(m_poolLabel);

    m_startBtn = ui::button("Start game", ui::Style::Primary, 96.f, 24.f, this, menu_selector(HubPopup::onGuessGo), .38f);
    m_startBtn->setPosition({ W - 16.f - 48.f, y });
    m_contentMenu->addChild(m_startBtn);
    refreshGuess();
}

void HubPopup::refreshGuess() {
    if (!m_poolLabel) return;
    auto n = guessPool(m_guess).size();
    int best = static_cast<int>(Mod::get()->getSavedValue<int64_t>(m_guess.bestKey(), 0));
    std::string text = n < 2 ? fmt::format("{} song{} match. Need 2+", n, n == 1 ? "" : "s")
        : fmt::format("{} songs match{}", n, best > 0 ? fmt::format("  -  best {}", best) : "");
    m_poolLabel->setString(text.c_str());
    m_poolLabel->setColor(n < 2 ? ui::DANGER : ui::MUTED);
    ui::setEnabled(m_startBtn, n >= 2);
    m_guess.save();
}

void HubPopup::onGuessType(CCObject* sender) {
    std::string t = TYPE_KEYS_ALL[std::clamp(static_cast<CCNode*>(sender)->getTag(), 0, TYPE_COUNT - 1)];
    auto it = std::find(m_guess.types.begin(), m_guess.types.end(), t);
    if (it != m_guess.types.end()) { if (m_guess.types.size() > 1) m_guess.types.erase(it); }
    else m_guess.types.push_back(t);
    showTab(Tab::Guess);
}

void HubPopup::onGuessStart(CCObject* sender) {
    m_guess.randomStart = static_cast<CCNode*>(sender)->getTag() == 1;
    showTab(Tab::Guess);
}

void HubPopup::onGuessDiff(CCObject* sender) {
    int i = static_cast<CCNode*>(sender)->getTag();
    if (i < 0) m_guess.diffs.clear();
    else if (i < DIFFICULTY_COUNT) {
        std::string d = DIFFICULTIES[i];
        auto it = std::find(m_guess.diffs.begin(), m_guess.diffs.end(), d);
        if (it != m_guess.diffs.end()) m_guess.diffs.erase(it);
        else m_guess.diffs.push_back(d);
    }
    showTab(Tab::Guess);
}

void HubPopup::onGuessLevel(CCObject* sender) {
    m_guess.level = std::clamp(static_cast<CCNode*>(sender)->getTag(), 0, GUESS_LEVEL_COUNT - 1);
    showTab(Tab::Guess);
}

void HubPopup::onGuessRounds(CCObject* sender) {
    m_guess.rounds = static_cast<CCNode*>(sender)->getTag();
    showTab(Tab::Guess);
}

void HubPopup::onGuessGo(CCObject*) {
    m_guess.save();
    if (guessPool(m_guess).size() < 2) return;
    Player::get()->stop();
    Ref<HubPopup> self = this;
    if (auto popup = GuessPopup::create(m_guess, [self] { if (self->m_tab == Tab::Guess) self->showTab(Tab::Guess); })) popup->show();
}
void HubPopup::onTab(CCObject* sender) {
    int i = static_cast<CCNode*>(sender)->getTag();
    Tab tab = i == 1 ? Tab::Requests : i == 2 ? Tab::Guess : Tab::Songs;
    if (tab == Tab::Requests) m_requestsLoaded = false;
    showTab(tab);
}

void HubPopup::loadCatalog(bool thenRebuild) {
    setLoading(true);
    m_catalogTask.spawn(gdsr::loadCatalog(), [this, thenRebuild](Result<> res) {
        setLoading(false);
        if (!res) { setStatus(res.unwrapErr(), ui::DANGER); return; }
        if (thenRebuild || m_tab != Tab::Requests) showTab(m_tab);
    });
}

void HubPopup::onRefresh(CCObject*) {
    m_requestsLoaded = false;
    clearContent();
    if (m_tab == Tab::Requests) { showTab(Tab::Requests); return; }
    loadCatalog(true);
}

void HubPopup::onSignIn(CCObject*) {
    Ref<HubPopup> self = this;
    LoginPopup::create([self] {
        self->refreshAccount();
        self->m_requestsLoaded = false;
        self->showTab(self->m_tab);
    })->show();
}

void HubPopup::onSignOut(CCObject*) {
    signOut();
    m_requestsLoaded = false;
    m_requests.clear();
    m_showMine = false;
    refreshAccount();
    showTab(m_tab);
}

void HubPopup::onSite(CCObject*) {
    web::openLinkInBrowser(SITE_URL);
}

}
