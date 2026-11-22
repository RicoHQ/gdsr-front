#include "ImportPopup.hpp"
#include "Theme.hpp"
#include "../net/Supabase.hpp"

#include <Geode/binding/MusicDownloadManager.hpp>
#include <algorithm>
#include <cstdlib>

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 390.f;
static constexpr float H = 312.f;
static constexpr size_t LOG_LINES = 6;

static char const* const MODE_NAMES[] = { "Level name", "Creator", "Song author", "Level list" };
static constexpr int MODES = 4;

ImportPopup* ImportPopup::create(std::string query) {
    auto ret = new ImportPopup();
    if (ret->init(std::move(query))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool ImportPopup::init(std::string query) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_mode = static_cast<ImportMode>(std::clamp<int64_t>(Mod::get()->getSavedValue<int64_t>("import-mode", 0), 0, MODES - 1));
    m_listType = static_cast<int>(Mod::get()->getSavedValue<int64_t>("import-list", 1));

    auto title = ui::label("GDSR IMPORT", "bigFont.fnt", .5f, ui::ACCENT);
    title->setPosition({ W / 2, H - 22.f });
    m_mainLayer->addChild(title);

    for (int i = 0; i < MODES; i++) {
        auto btn = ui::toggle(MODE_NAMES[i], false, 84.f, 20.f, this, menu_selector(ImportPopup::onMode), .3f);
        btn->setTag(i);
        btn->setPosition({ W / 2 + (i - 1.5f) * 90.f, H - 46.f });
        m_buttonMenu->addChild(btn);
        m_modeBtns.push_back(btn);
    }

    // the game's level lists, for the Level list tab
    auto const& types = searchTypes();
    for (size_t i = 0; i < types.size(); i++) {
        auto btn = ui::toggle(types[i].name, false, 84.f, 18.f, this, menu_selector(ImportPopup::onList), .28f);
        btn->setTag(static_cast<int>(i));
        btn->setPosition({ W / 2 + (static_cast<float>(i % 4) - 1.5f) * 90.f, H - 102.f - (i / 4) * 22.f });
        m_buttonMenu->addChild(btn);
        m_listBtns.push_back(btn);
    }

    m_query = TextInput::create(250.f, "Search...", "chatFont.fnt");
    m_query->setPosition({ 20.f + 125.f, H - 74.f });
    m_query->setString(query);
    m_mainLayer->addChild(m_query);

    m_limitLabel = ui::label("", "chatFont.fnt", .5f, ui::MUTED);
    m_limitLabel->setAnchorPoint({ 1.f, .5f });
    m_limitLabel->setPosition({ W - 20.f - 48.f - 6.f, H - 74.f });
    m_mainLayer->addChild(m_limitLabel);
    m_limit = TextInput::create(48.f, "2", "chatFont.fnt");
    m_limit->setCommonFilter(CommonFilter::Uint);
    m_limit->setMaxCharCount(4);
    m_limit->setPosition({ W - 20.f - 24.f, H - 74.f });
    m_mainLayer->addChild(m_limit);

    m_hint = ui::label("", "chatFont.fnt", .48f, ui::FAINT);
    m_hint->setAnchorPoint({ 0.f, .5f });
    m_hint->setPosition({ 20.f, H - 140.f });
    m_mainLayer->addChild(m_hint);
    m_stats = ui::label("", "chatFont.fnt", .5f, ui::TEXT);
    m_stats->setAnchorPoint({ 1.f, .5f });
    m_stats->setPosition({ W - 18.f, H - 140.f });
    m_mainLayer->addChild(m_stats);

    auto card = ui::card({ W - 32.f, 98.f });
    card->setAnchorPoint({ .5f, 1.f });
    card->setPosition({ W / 2, H - 152.f });
    m_mainLayer->addChild(card);
    m_logNode = CCNode::create();
    m_logNode->setPosition({ 24.f, H - 164.f });
    m_mainLayer->addChild(m_logNode);

    m_status = ui::label("", "chatFont.fnt", .6f, ui::MUTED);
    m_status->setAnchorPoint({ 0.f, .5f });
    m_status->setPosition({ 20.f, 30.f });
    m_mainLayer->addChild(m_status);
    m_spinner = LoadingSpinner::create(16.f);
    m_spinner->setPosition({ W - 20.f - 104.f - 14.f, 30.f });
    m_spinner->setVisible(false);
    m_mainLayer->addChild(m_spinner);
    m_startBtn = ui::button("Import", ui::Style::Primary, 96.f, 28.f, this, menu_selector(ImportPopup::onStart), .42f);
    m_startBtn->setPosition({ W - 20.f - 48.f, 30.f });
    m_buttonMenu->addChild(m_startBtn);

    m_limit->setPlaceholder(m_mode == ImportMode::SongAuthor ? "all" : "2");
    addLog("Adds every level found, and its song, that GDSR doesn't have yet.", ui::FAINT);
    setStatus("Levels and songs already on GDSR are skipped.", ui::FAINT);
    refresh();
    return true;
}

void ImportPopup::onClose(CCObject* sender) {
    m_running = false;
    this->unscheduleAllSelectors();
    Popup::onClose(sender);
}

void ImportPopup::refresh() {
    for (int i = 0; i < MODES; i++) {
        ui::setToggle(m_modeBtns[i], MODE_NAMES[i], static_cast<int>(m_mode) == i, 84.f, 20.f, .3f);
        ui::setEnabled(m_modeBtns[i], !m_running);
    }
    bool author = m_mode == ImportMode::SongAuthor, list = m_mode == ImportMode::LevelList;
    auto const& types = searchTypes();
    for (size_t i = 0; i < m_listBtns.size(); i++) {
        m_listBtns[i]->setVisible(list);
        ui::setToggle(m_listBtns[i], types[i].name, types[i].id == m_listType, 84.f, 18.f, .28f);
        ui::setEnabled(m_listBtns[i], !m_running);
    }
    m_query->setVisible(!list);
    m_limitLabel->setString(author ? "Songs" : "Pages");
    m_limitLabel->setScale(.5f);
    m_hint->setString(author ? "All the author's songs (blank = all), plus their top 5 levels each"
        : m_mode == ImportMode::Creator ? "Every level the player uploaded, 10 per page"
        : list ? "Levels from the chosen list, 10 per page"
        : "Levels whose name matches, 10 per page");
    m_hint->setScale(.48f);
    m_query->setEnabled(!m_running);
    m_limit->setEnabled(!m_running);
    m_stats->setString(fmt::format("Checked {}   Levels +{}   Songs +{}", m_checked, m_levels, m_songs).c_str());
    m_stats->setScale(.5f);
    float max = W - 40.f - m_stats->getScaledContentSize().width - 10.f;
    if (m_hint->getScaledContentSize().width > max) m_hint->setScale(.48f * max / m_hint->getScaledContentSize().width);
    ui::setButtonText(m_startBtn, m_running ? "Stop" : "Import", m_running ? ui::Style::Danger : ui::Style::Primary, 96.f, 28.f, .42f);
    m_spinner->setVisible(m_running);
}

void ImportPopup::addLog(std::string const& line, ccColor3B color) {
    m_log.push_front(line);
    while (m_log.size() > LOG_LINES) m_log.pop_back();
    m_logNode->removeAllChildren();
    float y = 0.f;
    bool first = true;
    for (auto const& l : m_log) {
        auto lbl = ui::fitLabel(l, "chatFont.fnt", .55f, first ? color : ui::MUTED, W - 50.f);
        lbl->setAnchorPoint({ 0.f, .5f });
        lbl->setPosition({ 0.f, y });
        if (!first) lbl->setOpacity(190);
        m_logNode->addChild(lbl);
        y -= 15.f;
        first = false;
    }
}

void ImportPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float max = W - 20.f - 150.f;
    m_status->setScale(.6f);
    if (m_status->getScaledContentSize().width > max) m_status->setScale(.6f * max / m_status->getScaledContentSize().width);
}

void ImportPopup::finish(std::string const& text, ccColor3B color) {
    m_running = false;
    this->unscheduleAllSelectors();
    m_steps.clear();
    m_queue.clear();
    setStatus(text, color);
    refresh();
}

void ImportPopup::onMode(CCObject* sender) {
    if (m_running) return;
    auto mode = static_cast<ImportMode>(static_cast<CCNode*>(sender)->getTag());
    if (mode != m_mode) m_limit->setString("");
    m_mode = mode;
    Mod::get()->setSavedValue<int64_t>("import-mode", static_cast<int64_t>(m_mode));
    m_limit->setPlaceholder(m_mode == ImportMode::SongAuthor ? "all" : "2");
    refresh();
}

void ImportPopup::onList(CCObject* sender) {
    if (m_running) return;
    auto i = static_cast<size_t>(static_cast<CCNode*>(sender)->getTag());
    if (i < searchTypes().size()) m_listType = searchTypes()[i].id;
    Mod::get()->setSavedValue<int64_t>("import-list", m_listType);
    refresh();
}

void ImportPopup::onStart(CCObject*) {
    if (m_running) {
        finish("Stopped.", ui::GOLD);
        addLog("Stopped.", ui::GOLD);
        return;
    }
    if (!signedIn() || !session().isAdmin) { setStatus("Sign in with an admin account first.", ui::DANGER); return; }
    auto query = m_query->getString();
    auto limitText = m_limit->getString();
    // blank: every song for a song author, 2 pages otherwise
    int limit = limitText.empty() ? (m_mode == ImportMode::SongAuthor ? 0 : 2) : static_cast<int>(std::strtol(limitText.c_str(), nullptr, 10));
    if (m_mode != ImportMode::SongAuthor) limit = std::max(1, limit);

    m_running = true;
    m_errors = 0;
    m_checked = m_levels = m_songs = 0;
    m_queuedSongs.clear();
    refresh();
    setStatus(m_mode == ImportMode::SongAuthor ? "Finding the author's songs..." : m_mode == ImportMode::Creator ? "Finding the player..." : "Searching...", ui::MUTED);
    m_planTask.spawn(planImport(m_mode, query, limit, m_listType), [this](Result<std::vector<ImportStep>> res) {
        if (!m_running) return;
        if (!res) { addLog(res.unwrapErr(), ui::DANGER); finish(res.unwrapErr(), ui::DANGER); return; }
        auto steps = std::move(res).unwrap();
        if (m_mode == ImportMode::SongAuthor) addLog(fmt::format("Found {} songs.", steps.size()), ui::TEXT);
        for (auto& s : steps) m_steps.push_back(std::move(s));
        setStatus("Running. Keep this window open.", ui::ACCENT);
        advance();
    });
}

void ImportPopup::advance() {
    if (!m_running) return;
    if (!m_queue.empty()) { this->scheduleOnce(schedule_selector(ImportPopup::nextJob), .3f); return; }
    if (m_steps.empty()) {
        addLog(fmt::format("Done: {} levels and {} songs added.", m_levels, m_songs), ui::ACCENT);
        finish("Finished.", ui::ACCENT);
        return;
    }
    // the Geometry Dash servers rate-limit bursts of searches
    this->scheduleOnce(schedule_selector(ImportPopup::nextStep), m_checked ? 1.5f : 0.f);
}

void ImportPopup::nextStep(float) {
    if (!m_running || m_steps.empty()) { advance(); return; }
    auto step = m_steps.front();
    setStatus(fmt::format("Searching {}...", step.label), ui::MUTED);
    m_stepTask.spawn(runImportStep(step, m_queuedSongs), [this, step](Result<AfkPage> res) {
        if (!m_running) return;
        if (!res) {
            addLog(step.label + ": " + res.unwrapErr(), ui::DANGER);
            if (++m_errors >= 4) { finish("Stopped after repeated errors. Try again later.", ui::DANGER); return; }
            this->scheduleOnce(schedule_selector(ImportPopup::nextStep), 8.f);
            return;
        }
        m_errors = 0;
        m_steps.pop_front();
        auto page = std::move(res).unwrap();
        m_checked += page.checked;
        // an empty page means the search has no more results
        if (page.checked == 0 && step.search.song == 0) {
            while (!m_steps.empty() && m_steps.front().search.song == 0) m_steps.pop_front();
        }
        addLog(fmt::format("{}: {} levels, {} new", step.label, page.checked, page.jobs.size()), page.jobs.empty() ? ui::FAINT : ui::TEXT);
        auto mdm = MusicDownloadManager::sharedState();
        for (auto& job : page.jobs) {
            if (job.addSong) m_queuedSongs.insert(job.level.songID);
            // use the copy in the game folder when the song is already downloaded
            if (job.addSong && job.level.songID > 0 && mdm) {
                std::string path = std::string(mdm->pathForSong(static_cast<int>(job.level.songID)));
                std::error_code ec;
                auto p = std::filesystem::path(std::u8string(reinterpret_cast<char8_t const*>(path.data()), path.size()));
                if (!path.empty() && std::filesystem::exists(p, ec)) job.localPath = path;
            }
            m_queue.push_back(std::move(job));
        }
        refresh();
        advance();
    });
}

void ImportPopup::nextJob(float) {
    if (!m_running || m_queue.empty()) { advance(); return; }
    auto job = std::move(m_queue.front());
    m_queue.pop_front();
    setStatus(fmt::format("Adding {}...", job.level.name), ui::MUTED);
    m_importTask.spawn(afkImport(std::move(job)), [this](Result<AfkResult> res) {
        if (!res) addLog(res.unwrapErr(), ui::DANGER);
        else {
            auto r = res.unwrap();
            if (r.levelAdded) m_levels++;
            if (r.songAdded) m_songs++;
            addLog(r.message, r.levelAdded || r.songAdded ? ui::ACCENT : ui::GOLD);
        }
        refresh();
        advance();
    });
}

}
