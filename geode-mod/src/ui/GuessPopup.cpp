#include "GuessPopup.hpp"
#include "Theme.hpp"
#include "../audio/Player.hpp"

#include <random>

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 400.f;
static constexpr float H = 272.f;
static constexpr float CHOICE_W = 182.f;
static constexpr float CHOICE_H = 38.f;
static constexpr int MAX_PLAYS = 3;
static char const* GUESS_PLAYER_ID = "gdsr-guess";

static std::mt19937& rng() {
    static std::mt19937 gen{ std::random_device{}() };
    return gen;
}

template <class T>
static void shuffle(std::vector<T>& v) { std::shuffle(v.begin(), v.end(), rng()); }

GuessPopup* GuessPopup::create(GuessConfig cfg, std::function<void()> onDone) {
    auto ret = new GuessPopup();
    if (ret->init(std::move(cfg), std::move(onDone))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool GuessPopup::init(GuessConfig cfg, std::function<void()> onDone) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_cfg = std::move(cfg);
    m_onDone = std::move(onDone);

    auto title = ui::label("GUESS THE SONG", "bigFont.fnt", .32f, ui::ACCENT);
    title->setPosition({ W / 2, H - 18.f });
    m_mainLayer->addChild(title);

    m_hud = ui::label("", "chatFont.fnt", .65f, ui::MUTED);
    m_hud->setPosition({ W / 2, H - 35.f });
    m_mainLayer->addChild(m_hud);

    Ref<GuessPopup> self = this;
    Player::get()->setListener(this, [self] { self->onPlayer(); });
    newGame();
    return true;
}

void GuessPopup::onClose(CCObject* sender) {
    Player::get()->clearListener(this);
    if (Player::get()->id() == GUESS_PLAYER_ID) Player::get()->stop();
    if (m_onDone) m_onDone();
    Popup::onClose(sender);
}

void GuessPopup::newGame() {
    auto pool = guessPool(m_cfg);
    shuffle(pool);
    std::vector<Song const*> all;
    for (auto const& s : catalog().songs) if (!s.audioFile.empty()) all.push_back(&s);

    m_rounds.clear();
    size_t count = std::min<size_t>(static_cast<size_t>(m_cfg.rounds), pool.size());
    for (size_t i = 0; i < count; i++) {
        Round r;
        r.songId = pool[i]->id;
        // wrong answers: other songs from the same pool first, then any song
        std::vector<Song const*> others, extra;
        for (auto s : pool) if (s->id != r.songId) others.push_back(s);
        for (auto s : all) if (s->id != r.songId && std::find(others.begin(), others.end(), s) == others.end()) extra.push_back(s);
        shuffle(others);
        shuffle(extra);
        r.choices.push_back(r.songId);
        for (auto s : others) { if (r.choices.size() >= 4) break; r.choices.push_back(s->id); }
        for (auto s : extra) { if (r.choices.size() >= 4) break; r.choices.push_back(s->id); }
        shuffle(r.choices);
        m_rounds.push_back(std::move(r));
    }
    m_index = 0;
    m_score = 0;
    m_streak = 0;
    m_bestStreak = 0;
    m_finished = false;
    buildRound();
}

static CCNode* choiceSprite(Song const* s, int number, int state) {
    // state: 0 open, 1 right, 2 wrong, 3 dimmed
    auto node = CCNode::create();
    node->setContentSize({ CHOICE_W, CHOICE_H });
    node->setAnchorPoint({ .5f, .5f });
    auto bg = ui::card({ CHOICE_W, CHOICE_H }, state == 1);
    bg->setPosition({ CHOICE_W / 2, CHOICE_H / 2 });
    if (state == 1) bg->setColor({ 150, 255, 190 });
    if (state == 2) bg->setColor({ 255, 140, 140 });
    node->addChild(bg);

    auto key = ui::label(fmt::format("{}", number), "bigFont.fnt", .32f, state == 1 ? ui::ACCENT : state == 2 ? ui::DANGER : ui::FAINT);
    key->setPosition({ 14.f, CHOICE_H / 2 });
    node->addChild(key);

    auto name = ui::fitLabel(s ? s->name : "?", "bigFont.fnt", .34f, ui::TEXT, CHOICE_W - 36.f);
    name->setAnchorPoint({ 0.f, .5f });
    name->setPosition({ 28.f, CHOICE_H / 2 + 6.f });
    node->addChild(name);

    std::string subText = s ? fmt::format("{}{}", s->author.empty() ? "" : s->author + "  -  ", typeLabel(s->type)) : "";
    auto sub = ui::fitLabel(subText, "chatFont.fnt", .5f, ui::MUTED, CHOICE_W - 36.f);
    sub->setAnchorPoint({ 0.f, .5f });
    sub->setPosition({ 28.f, CHOICE_H / 2 - 7.f });
    node->addChild(sub);

    if (state == 3) {
        for (auto child : CCArrayExt<CCNode*>(node->getChildren())) {
            if (auto rgba = typeinfo_cast<CCRGBAProtocol*>(child)) rgba->setOpacity(110);
        }
    }
    return node;
}

void GuessPopup::buildRound() {
    if (m_content) m_content->removeFromParent();
    m_content = CCNode::create();
    m_mainLayer->addChild(m_content);
    m_menu = CCMenu::create();
    m_menu->setPosition({ 0, 0 });
    m_content->addChild(m_menu, 2);
    m_playBtn = nullptr;
    m_bar = nullptr;

    if (m_rounds.empty()) {
        setHint("No songs to guess.", ui::DANGER);
        return;
    }
    auto& r = m_rounds[m_index];
    auto const& lvl = m_cfg.gameLevel();
    bool done = !r.pick.empty();

    // new random rounds with the same settings
    auto restart = ui::iconButton("ic_refresh.png"_spr, ui::Style::Dark, 24.f, this, menu_selector(GuessPopup::onRestart));
    restart->setPosition({ W - 22.f, H - 22.f });
    m_menu->addChild(restart);

    m_hud->setString(fmt::format("Round {}/{}     Score {}     Streak {}     {} - {}{}", m_index + 1, m_rounds.size(), m_score, m_streak,
        lvl.label, clipText(lvl.clip), m_cfg.randomStart ? " - random part" : "").c_str());

    m_playBtn = ui::button("Play clip", ui::Style::Primary, 150.f, 30.f, this, menu_selector(GuessPopup::onPlay), .42f);
    m_playBtn->setPosition({ W / 2, H - 66.f });
    m_menu->addChild(m_playBtn);

    auto barBg = ui::rect(220.f, 4.f, { 29, 43, 35 });
    barBg->setPosition({ W / 2, H - 88.f });
    m_content->addChild(barBg);
    m_bar = ui::rect(0.f, 4.f, ui::ACCENT);
    m_bar->setAnchorPoint({ 0.f, .5f });
    m_bar->setPosition({ W / 2 - 110.f, H - 88.f });
    m_content->addChild(m_bar);

    m_hint = ui::label("", "chatFont.fnt", .6f, ui::MUTED);
    m_hint->setPosition({ W / 2, H - 102.f });
    m_content->addChild(m_hint);

    for (size_t i = 0; i < r.choices.size(); i++) {
        auto const& id = r.choices[i];
        int state = !done ? 0 : id == r.songId ? 1 : id == r.pick ? 2 : 3;
        auto btn = CCMenuItemSpriteExtra::create(choiceSprite(catalog().byId(id), static_cast<int>(i) + 1, state), this, menu_selector(GuessPopup::onChoice));
        btn->setTag(static_cast<int>(i));
        btn->m_scaleMultiplier = 1.04f;
        btn->setEnabled(!done);
        float x = W / 2 + (i % 2 == 0 ? -1.f : 1.f) * (CHOICE_W / 2 + 4.f);
        float y = 134.f - (i / 2) * (CHOICE_H + 8.f);
        btn->setPosition({ x, y });
        m_menu->addChild(btn);
    }

    auto line = ui::rect(W - 28.f, 1.f, { 29, 43, 35 });
    line->setPosition({ W / 2, 46.f });
    m_content->addChild(line);

    if (done) {
        bool ok = r.pick == r.songId;
        auto s = catalog().byId(r.songId);
        auto txt = ok ? fmt::format("Correct! +{}", r.points) : r.pick == "skip" ? "Skipped" : "Not quite";
        auto res = ui::label(txt, "bigFont.fnt", .36f, ok ? ui::ACCENT : ui::DANGER);
        res->setAnchorPoint({ 0.f, .5f });
        res->setPosition({ 18.f, 30.f });
        m_content->addChild(res);
        auto name = ui::fitLabel(s ? s->name : "", "chatFont.fnt", .6f, ui::TEXT, W - 200.f - res->getScaledContentSize().width);
        name->setAnchorPoint({ 0.f, .5f });
        name->setPosition({ 24.f + res->getScaledContentSize().width, 29.f });
        m_content->addChild(name);

        auto next = ui::button(m_index + 1 < m_rounds.size() ? "Next" : "Results", ui::Style::Primary, 84.f, 26.f, this, menu_selector(GuessPopup::onNext), .4f);
        next->setPosition({ W - 18.f - 42.f, 28.f });
        m_menu->addChild(next);
        ui::setButtonText(m_playBtn, "Hear more", ui::Style::Dark, 150.f, 30.f, .42f);
        setHint(ok ? "Nice ear!" : "The right answer is highlighted.", ui::FAINT);
    } else {
        auto skip = ui::button("Skip", ui::Style::Dark, 64.f, 26.f, this, menu_selector(GuessPopup::onSkip), .38f);
        skip->setPosition({ W - 18.f - 32.f, 28.f });
        m_menu->addChild(skip);
        auto quit = ui::button("Quit", ui::Style::Dark, 64.f, 26.f, this, menu_selector(GuessPopup::onQuit), .38f);
        quit->setPosition({ 18.f + 32.f, 28.f });
        m_menu->addChild(quit);
        if (m_audio.empty() || r.plays == 0) loadRoundAudio();
        else setHint(fmt::format("{} replay{} left", MAX_PLAYS - r.plays, MAX_PLAYS - r.plays == 1 ? "" : "s"), ui::MUTED);
    }
    m_playerKey = "?";
    onPlayer();
}

void GuessPopup::setHint(std::string const& text, ccColor3B color) {
    if (!m_hint) return;
    m_hint->setString(text.c_str());
    m_hint->setColor(color);
}

void GuessPopup::loadRoundAudio() {
    auto& r = m_rounds[m_index];
    auto s = catalog().byId(r.songId);
    if (!s) return;
    m_loading = true;
    m_audio.clear();
    setHint("Loading the clip...", ui::MUTED);
    if (m_playBtn) ui::setEnabled(m_playBtn, false);
    m_audioTask.spawn(fetchAudio(s->audioFile), [this](Result<std::filesystem::path> res) {
        m_loading = false;
        if (m_playBtn) ui::setEnabled(m_playBtn, true);
        if (!res) {
            setHint("Couldn't load this clip, so it's skipped.", ui::DANGER);
            answer("skip");
            return;
        }
        m_audio = res.unwrap();
        auto& r = m_rounds[m_index];
        if (r.startMs < 0) {
            int clipMs = static_cast<int>(m_cfg.gameLevel().clip * 1000);
            int len = static_cast<int>(audioLengthMs(m_audio));
            int room = len - clipMs - 2000;
            r.startMs = m_cfg.randomStart && room > 0 ? std::uniform_int_distribution<int>(0, room)(rng()) : 0;
        }
        playClip(false);
        if (m_index + 1 < m_rounds.size()) {
            if (auto next = catalog().byId(m_rounds[m_index + 1].songId)) m_prefetchTask.spawn(fetchAudio(next->audioFile), [](Result<std::filesystem::path>) {});
        }
    });
}

void GuessPopup::playClip(bool reveal) {
    if (m_audio.empty() || m_rounds.empty()) return;
    auto& r = m_rounds[m_index];
    if (!reveal && r.plays >= MAX_PLAYS) { setHint("No replays left. Make your guess!", ui::GOLD); return; }
    unsigned clip = reveal ? 15000u : static_cast<unsigned>(m_cfg.gameLevel().clip * 1000);
    std::string title = "Guess the Song";
    if (reveal) if (auto s = catalog().byId(r.songId)) title = s->name;
    auto played = Player::get()->play(m_audio, GUESS_PLAYER_ID, title, static_cast<unsigned>(std::max(0, r.startMs)), clip);
    if (!played) { setHint(played.unwrapErr(), ui::DANGER); return; }
    if (!reveal) {
        r.plays++;
        int left = MAX_PLAYS - r.plays;
        setHint(left > 0 ? fmt::format("Listening...  {} replay{} left", left, left == 1 ? "" : "s") : "Listening...  last play", ui::MUTED);
    }
}

void GuessPopup::onPlayer() {
    auto p = Player::get();
    bool mine = p->active() && p->id() == GUESS_PLAYER_ID;
    if (m_bar) ui::sizeRect(m_bar, mine ? 220.f * p->progress() : 0.f, 4.f);
    std::string key = mine ? "playing" : "idle";
    if (key == m_playerKey || !m_playBtn || m_rounds.empty()) return;
    m_playerKey = key;
    auto& r = m_rounds[m_index];
    bool done = !r.pick.empty();
    if (done) return;
    if (!mine && !m_loading) {
        int left = MAX_PLAYS - r.plays;
        ui::setButtonText(m_playBtn, r.plays == 0 ? "Play clip" : left > 0 ? fmt::format("Replay ({} left)", left) : "No replays left",
            left > 0 ? ui::Style::Primary : ui::Style::Dark, 150.f, 30.f, .4f);
        if (r.plays > 0) setHint(left > 0 ? "Which song was it?" : "Which song was it? No replays left.", ui::MUTED);
    } else if (mine) {
        ui::setButtonText(m_playBtn, "Playing...", ui::Style::Dark, 150.f, 30.f, .42f);
    }
}

void GuessPopup::onPlay(CCObject*) {
    if (m_rounds.empty() || m_loading) return;
    auto& r = m_rounds[m_index];
    bool done = !r.pick.empty();
    if (done) {
        if (Player::get()->id() == GUESS_PLAYER_ID) { Player::get()->stop(); return; }
        playClip(true);
        return;
    }
    if (Player::get()->active() && Player::get()->id() == GUESS_PLAYER_ID) return;
    if (m_audio.empty()) { loadRoundAudio(); return; }
    playClip(false);
}

void GuessPopup::answer(std::string const& id) {
    auto& r = m_rounds[m_index];
    if (!r.pick.empty()) return;
    r.pick = id;
    if (Player::get()->id() == GUESS_PLAYER_ID) Player::get()->stop();
    if (id == r.songId) {
        m_streak++;
        m_bestStreak = std::max(m_bestStreak, m_streak);
        static int const base[] = { 100, 100, 75, 50 };
        int b = base[std::clamp(r.plays, 0, 3)];
        r.points = static_cast<int>(std::round(b * m_cfg.gameLevel().mult)) + std::min(50, (m_streak - 1) * 10);
        m_score += r.points;
    } else {
        m_streak = 0;
    }
    Ref<GuessPopup> self = this;
    queueInMainThread([self] { self->buildRound(); });
}

void GuessPopup::onChoice(CCObject* sender) {
    if (m_rounds.empty()) return;
    int i = static_cast<CCNode*>(sender)->getTag();
    auto& r = m_rounds[m_index];
    if (i < 0 || i >= static_cast<int>(r.choices.size())) return;
    answer(r.choices[i]);
}

void GuessPopup::onSkip(CCObject*) { answer("skip"); }

void GuessPopup::onNext(CCObject*) {
    if (Player::get()->id() == GUESS_PLAYER_ID) Player::get()->stop();
    m_audio.clear();
    if (m_index + 1 < m_rounds.size()) { m_index++; buildRound(); }
    else buildResults();
}

void GuessPopup::buildResults() {
    m_finished = true;
    if (m_content) m_content->removeFromParent();
    m_content = CCNode::create();
    m_mainLayer->addChild(m_content);
    m_menu = CCMenu::create();
    m_menu->setPosition({ 0, 0 });
    m_content->addChild(m_menu, 2);
    m_playBtn = nullptr;
    m_bar = nullptr;
    m_hint = nullptr;

    int right = 0;
    for (auto const& r : m_rounds) if (r.pick == r.songId) right++;
    auto key = m_cfg.bestKey();
    int prev = static_cast<int>(Mod::get()->getSavedValue<int64_t>(key, 0));
    bool best = m_score > prev;
    if (best) Mod::get()->setSavedValue<int64_t>(key, m_score);

    m_hud->setString(fmt::format("{} - {}{}", m_cfg.gameLevel().label, clipText(m_cfg.gameLevel().clip), m_cfg.randomStart ? " - random parts" : " - from the start").c_str());

    auto score = ui::label(fmt::format("{}", m_score), "bigFont.fnt", 1.1f, ui::ACCENT);
    score->setPosition({ W / 2, H - 76.f });
    m_content->addChild(score);
    auto sub = ui::label(best ? "New best score!" : fmt::format("Best: {}", std::max(prev, m_score)), "bigFont.fnt", .34f, best ? ui::GOLD : ui::MUTED);
    sub->setPosition({ W / 2, H - 104.f });
    m_content->addChild(sub);

    auto stat = [&](std::string const& value, char const* caption, float x) {
        auto card = ui::card({ 110.f, 46.f });
        card->setPosition({ x, 118.f });
        m_content->addChild(card);
        auto b = ui::label(value, "bigFont.fnt", .48f, ui::TEXT);
        b->setPosition({ x, 124.f });
        m_content->addChild(b);
        auto s = ui::label(caption, "chatFont.fnt", .5f, ui::FAINT);
        s->setPosition({ x, 106.f });
        m_content->addChild(s);
    };
    stat(fmt::format("{}/{}", right, m_rounds.size()), "correct", W / 2 - 118.f);
    stat(fmt::format("{}", m_bestStreak), "best streak", W / 2);
    int pct = m_rounds.empty() ? 0 : static_cast<int>(std::round(100.0 * right / m_rounds.size()));
    stat(fmt::format("{}%", pct), "accuracy", W / 2 + 118.f);

    auto again = ui::button("Play again", ui::Style::Primary, 110.f, 28.f, this, menu_selector(GuessPopup::onAgain), .4f);
    again->setPosition({ W / 2 + 60.f, 40.f });
    m_menu->addChild(again);
    auto close = ui::button("Change settings", ui::Style::Dark, 110.f, 28.f, this, menu_selector(GuessPopup::onQuit), .34f);
    close->setPosition({ W / 2 - 60.f, 40.f });
    m_menu->addChild(close);
}

void GuessPopup::onAgain(CCObject*) { m_audio.clear(); newGame(); }
void GuessPopup::onQuit(CCObject*) { onClose(nullptr); }

void GuessPopup::onRestart(CCObject*) {
    if (Player::get()->id() == GUESS_PLAYER_ID) Player::get()->stop();
    m_audio.clear();
    newGame();
}

void GuessPopup::keyDown(enumKeyCodes key, double timestamp) {
    if (!m_finished && !m_rounds.empty()) {
        auto& r = m_rounds[m_index];
        bool done = !r.pick.empty();
        if (key == KEY_Space) { if (done) onNext(nullptr); else onPlay(nullptr); return; }
        if (key == KEY_Enter && done) { onNext(nullptr); return; }
        if (!done && key >= KEY_One && key <= KEY_Four) {
            size_t i = static_cast<size_t>(key - KEY_One);
            if (i < r.choices.size()) answer(r.choices[i]);
            return;
        }
    }
    Popup::keyDown(key, timestamp);
}

}
