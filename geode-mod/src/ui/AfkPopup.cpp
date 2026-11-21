#include "AfkPopup.hpp"
#include "Theme.hpp"
#include "AfkFilterPopup.hpp"

#include <Geode/binding/MusicDownloadManager.hpp>
#include <algorithm>
#include <cstdlib>

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 390.f;
static constexpr float H = 282.f;
static constexpr size_t LOG_LINES = 7;

AfkPopup* AfkPopup::create(std::function<void()> onChanged) {
    auto ret = new AfkPopup();
    if (ret->init(std::move(onChanged))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool AfkPopup::init(std::function<void()> onChanged) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_onChanged = std::move(onChanged);
    m_page = static_cast<int>(Mod::get()->getSavedValue<int64_t>("afk-page", 0));
    m_search = GDSearch::fromJson(Mod::get()->getSavedValue<matjson::Value>("afk-search", matjson::Value()));

    auto title = ui::label("AFK ADMIN", "bigFont.fnt", .5f, ui::ACCENT);
    title->setPosition({ W / 2, H - 22.f });
    m_mainLayer->addChild(title);
    auto sub = ui::label("Adds levels from the game's level lists, and their songs, that GDSR doesn't have yet.", "chatFont.fnt", .58f, ui::MUTED);
    sub->setPosition({ W / 2, H - 40.f });
    if (sub->getScaledContentSize().width > W - 30.f) sub->setScale(sub->getScale() * (W - 30.f) / sub->getScaledContentSize().width);
    m_mainLayer->addChild(sub);

    m_levelsBtn = ui::toggle("Levels", true, 76.f, 20.f, this, menu_selector(AfkPopup::onLevels), .32f);
    m_levelsBtn->setPosition({ 20.f + 38.f, H - 64.f });
    m_buttonMenu->addChild(m_levelsBtn);
    m_songsBtn = ui::toggle("Songs", true, 76.f, 20.f, this, menu_selector(AfkPopup::onSongs), .32f);
    m_songsBtn->setPosition({ 20.f + 38.f + 82.f, H - 64.f });
    m_buttonMenu->addChild(m_songsBtn);

    m_filterBtn = ui::button("Filters", ui::Style::Dark, 76.f, 20.f, this, menu_selector(AfkPopup::onFilters), .32f);
    m_filterBtn->setPosition({ 20.f + 38.f + 164.f, H - 64.f });
    m_buttonMenu->addChild(m_filterBtn);

    auto pageLbl = ui::label("Page", "chatFont.fnt", .55f, ui::MUTED);
    pageLbl->setAnchorPoint({ 1.f, .5f });
    pageLbl->setPosition({ W - 96.f, H - 64.f });
    m_mainLayer->addChild(pageLbl);
    m_pageInput = TextInput::create(58.f, "1", "chatFont.fnt");
    m_pageInput->setCommonFilter(CommonFilter::Uint);
    m_pageInput->setMaxCharCount(6);
    m_pageInput->setScale(.8f);
    m_pageInput->setPosition({ W - 20.f - 22.f - 4.f - 23.f, H - 64.f });
    m_pageInput->setString(std::to_string(m_page + 1));
    m_mainLayer->addChild(m_pageInput);
    m_resetBtn = ui::iconButton("ic_refresh.png"_spr, ui::Style::Dark, 22.f, this, menu_selector(AfkPopup::onReset));
    m_resetBtn->setPosition({ W - 20.f - 11.f, H - 64.f });
    m_buttonMenu->addChild(m_resetBtn);

    m_filterInfo = ui::label("", "chatFont.fnt", .52f, ui::ACCENT);
    m_filterInfo->setAnchorPoint({ 0.f, .5f });
    m_filterInfo->setPosition({ 20.f, H - 86.f });
    m_mainLayer->addChild(m_filterInfo);
    m_stats = ui::label("", "chatFont.fnt", .52f, ui::TEXT);
    m_stats->setAnchorPoint({ 1.f, .5f });
    m_stats->setPosition({ W - 18.f, H - 86.f });
    m_mainLayer->addChild(m_stats);

    auto card = ui::card({ W - 32.f, 112.f });
    card->setAnchorPoint({ .5f, 1.f });
    card->setPosition({ W / 2, H - 98.f });
    m_mainLayer->addChild(card);
    m_logNode = CCNode::create();
    m_logNode->setPosition({ 24.f, H - 110.f });
    m_mainLayer->addChild(m_logNode);

    m_status = ui::label("", "chatFont.fnt", .6f, ui::MUTED);
    m_status->setAnchorPoint({ 0.f, .5f });
    m_status->setPosition({ 20.f, 30.f });
    m_mainLayer->addChild(m_status);

    m_spinner = LoadingSpinner::create(16.f);
    m_spinner->setPosition({ W - 20.f - 110.f - 14.f, 30.f });
    m_spinner->setVisible(false);
    m_mainLayer->addChild(m_spinner);

    m_startBtn = ui::button("Start", ui::Style::Primary, 104.f, 28.f, this, menu_selector(AfkPopup::onStart), .42f);
    m_startBtn->setPosition({ W - 20.f - 52.f, 30.f });
    m_buttonMenu->addChild(m_startBtn);

    addLog(fmt::format("Ready. Starts at page {} of {}.", m_page + 1, m_search.summary()), ui::FAINT);
    setStatus("Keep this window open while it runs.", ui::FAINT);
    refresh();
    return true;
}

void AfkPopup::onClose(CCObject* sender) {
    m_running = false;
    this->unscheduleAllSelectors();
    if ((m_levels || m_songs) && m_onChanged) m_onChanged();
    Popup::onClose(sender);
}

void AfkPopup::refresh() {
    ui::setButtonText(m_startBtn, m_running ? "Stop" : (m_checked ? "Resume" : "Start"), m_running ? ui::Style::Danger : ui::Style::Primary, 104.f, 28.f, .42f);
    ui::setToggle(m_levelsBtn, "Levels", m_doLevels, 76.f, 20.f, .32f);
    ui::setToggle(m_songsBtn, "Songs", m_doSongs, 76.f, 20.f, .32f);
    ui::setEnabled(m_levelsBtn, !m_running);
    ui::setEnabled(m_songsBtn, !m_running);
    ui::setEnabled(m_resetBtn, !m_running && m_page > 0);
    ui::setEnabled(m_filterBtn, !m_running);
    m_pageInput->setEnabled(!m_running);
    if (m_running) m_pageInput->setString(std::to_string(m_page + 1));
    m_stats->setString(fmt::format("Checked {}   Levels +{}   Songs +{}", m_checked, m_levels, m_songs).c_str());
    m_stats->setScale(.52f);
    float statsW = m_stats->getScaledContentSize().width;
    m_filterInfo->setString(m_search.summary().c_str());
    m_filterInfo->setScale(.52f);
    float max = W - 40.f - statsW - 12.f;
    if (m_filterInfo->getScaledContentSize().width > max) m_filterInfo->setScale(.52f * max / m_filterInfo->getScaledContentSize().width);
    m_spinner->setVisible(m_running);
}

void AfkPopup::addLog(std::string const& line, ccColor3B color) {
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

void AfkPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float max = W - 20.f - 150.f;
    m_status->setScale(.6f);
    if (m_status->getScaledContentSize().width > max) m_status->setScale(.6f * max / m_status->getScaledContentSize().width);
}

void AfkPopup::onStart(CCObject*) {
    if (m_running) {
        m_running = false;
        this->unscheduleAllSelectors();
        setStatus("Stopped. Press Resume to carry on from here.", ui::GOLD);
        addLog("Stopped.", ui::GOLD);
        refresh();
        return;
    }
    if (!signedIn() || !session().isAdmin) { setStatus("Sign in with an admin account first.", ui::DANGER); return; }
    if (!m_doLevels && !m_doSongs) { setStatus("Pick levels, songs, or both.", ui::GOLD); return; }
    readPageInput();
    m_reachedEnd = false;
    m_running = true;
    refresh();
    setStatus("Running. You can go AFK now.", ui::ACCENT);
    step();
}

void AfkPopup::setPage(int page) {
    m_page = std::max(0, page);
    Mod::get()->setSavedValue<int64_t>("afk-page", m_page);
    if (m_pageInput) m_pageInput->setString(std::to_string(m_page + 1));
}

void AfkPopup::readPageInput() {
    auto text = m_pageInput->getString();
    if (text.empty()) return;
    int page = std::max(1, static_cast<int>(std::strtol(text.c_str(), nullptr, 10))) - 1;
    if (page != m_page) {
        m_queue.clear();
        setPage(page);
        addLog(fmt::format("Starting at page {}.", m_page + 1), ui::FAINT);
    }
}

void AfkPopup::onReset(CCObject*) {
    if (m_running) return;
    m_queue.clear();
    setPage(0);
    addLog("Back to page 1.", ui::FAINT);
    refresh();
}

void AfkPopup::onFilters(CCObject*) {
    if (m_running) return;
    AfkFilterPopup::create(m_search, [this](GDSearch search) {
        bool changed = !(search.toJson() == m_search.toJson());
        m_search = std::move(search);
        Mod::get()->setSavedValue("afk-search", m_search.toJson());
        if (changed) {
            // a different list, so start it from the top
            m_queue.clear();
            setPage(0);
            addLog("Filters: " + m_search.summary(), ui::ACCENT);
        }
        refresh();
    })->show();
}

void AfkPopup::onLevels(CCObject*) { if (!m_running) { m_doLevels = !m_doLevels; refresh(); } }
void AfkPopup::onSongs(CCObject*) { if (!m_running) { m_doSongs = !m_doSongs; refresh(); } }
void AfkPopup::step() {
    if (!m_running) return;
    if (!m_queue.empty()) { this->scheduleOnce(schedule_selector(AfkPopup::nextJob), .4f); return; }
    if (m_reachedEnd) {
        m_running = false;
        addLog(fmt::format("No more levels after page {}. Done.", m_page), ui::ACCENT);
        setStatus("Finished this list.", ui::ACCENT);
        refresh();
        return;
    }
    // boomlings rate-limits bursts
    this->scheduleOnce(schedule_selector(AfkPopup::nextPage), m_checked ? 2.5f : 0.f);
}

void AfkPopup::nextPage(float) {
    if (!m_running) return;
    setStatus(fmt::format("Reading page {}...", m_page + 1), ui::MUTED);
    m_pageTask.spawn(afkFetchPage(m_search, m_page, m_doLevels, m_doSongs), [this](Result<AfkPage> res) {
        if (!m_running) return;
        if (!res) {
            m_errors++;
            addLog("Page " + std::to_string(m_page + 1) + ": " + res.unwrapErr(), ui::DANGER);
            if (m_errors >= 5) {
                m_running = false;
                setStatus("Stopped after repeated errors. Try again later.", ui::DANGER);
                refresh();
                return;
            }
            this->scheduleOnce(schedule_selector(AfkPopup::nextPage), 10.f);
            return;
        }
        m_errors = 0;
        auto page = std::move(res).unwrap();
        m_checked += page.checked;
        int newOnes = static_cast<int>(page.jobs.size());
        addLog(fmt::format("Page {}: {} levels, {} with something new", m_page + 1, page.checked, newOnes), newOnes ? ui::TEXT : ui::FAINT);
        // MusicDownloadManager has to be used on the main thread
        auto mdm = MusicDownloadManager::sharedState();
        for (auto& job : page.jobs) {
            if (job.addSong && job.level.songID > 0 && mdm) {
                std::string path = std::string(mdm->pathForSong(static_cast<int>(job.level.songID)));
                std::error_code ec;
                auto p = std::filesystem::path(std::u8string(reinterpret_cast<char8_t const*>(path.data()), path.size()));
                if (!path.empty() && std::filesystem::exists(p, ec)) job.localPath = path;
            }
            m_queue.push_back(std::move(job));
        }
        if (page.checked == 0) m_reachedEnd = true;
        else setPage(m_page + 1);
        refresh();
        step();
    });
}

void AfkPopup::nextJob(float) {
    if (!m_running || m_queue.empty()) { step(); return; }
    auto job = std::move(m_queue.front());
    m_queue.pop_front();
    setStatus(fmt::format("Adding {}...", job.level.name), ui::MUTED);
    m_importTask.spawn(afkImport(std::move(job)), [this](Result<AfkResult> res) {
        if (!res) {
            addLog(res.unwrapErr(), ui::DANGER);
        } else {
            auto r = res.unwrap();
            if (r.levelAdded) m_levels++;
            if (r.songAdded) m_songs++;
            addLog(r.message, r.levelAdded || r.songAdded ? ui::ACCENT : ui::GOLD);
        }
        refresh();
        step();
    });
}

}
