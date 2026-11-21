#include "Player.hpp"

#include <Geode/binding/FMODAudioEngine.hpp>
#include <Geode/utils/file.hpp>
#include <fmod.hpp>

using namespace geode::prelude;

namespace gdsr {

Player* Player::get() {
    static Player* instance = [] { auto p = new Player(); p->retain(); return p; }();
    return instance;
}

static FMOD::System* fmodSystem() {
    auto engine = FMODAudioEngine::sharedEngine();
    return engine ? engine->m_system : nullptr;
}

static float playerVolume() {
    auto v = Mod::get()->getSettingValue<int64_t>("player-volume");
    return std::clamp(static_cast<float>(v) / 100.f, 0.f, 1.f);
}

void Player::freeSound() {
    if (m_channel) { m_channel->stop(); m_channel = nullptr; }
    if (m_sound) { m_sound->release(); m_sound = nullptr; }
    m_data.clear();
    m_data.shrink_to_fit();
}

Result<> Player::play(std::filesystem::path const& file, std::string id, std::string title, unsigned startMs, unsigned clipMs) {
    auto system = fmodSystem();
    if (!system) return Err("The game's audio engine isn't ready.");
    auto data = file::readBinary(file);
    if (!data) { log::warn("GDSR player: can't read {}", file.string()); return Err("Couldn't read the audio file."); }

    freeSound();
    m_data = std::move(data).unwrap();
    FMOD_CREATESOUNDEXINFO ex{};
    ex.cbsize = sizeof(ex);
    ex.length = static_cast<unsigned int>(m_data.size());
    auto r = system->createSound(reinterpret_cast<char const*>(m_data.data()), FMOD_OPENMEMORY_POINT | FMOD_CREATESTREAM | FMOD_2D, &ex, &m_sound);
    if (r != FMOD_OK || !m_sound) { log::warn("GDSR player: createSound failed ({})", static_cast<int>(r)); m_sound = nullptr; m_data.clear(); return Err(fmt::format("This audio can't be played (FMOD error {}).", static_cast<int>(r))); }

    m_lengthMs = 0;
    m_sound->getLength(&m_lengthMs, FMOD_TIMEUNIT_MS);
    if (m_lengthMs && startMs >= m_lengthMs) startMs = 0;

    r = system->playSound(m_sound, nullptr, true, &m_channel);
    if (r != FMOD_OK || !m_channel) { log::warn("GDSR player: playSound failed ({})", static_cast<int>(r)); freeSound(); return Err(fmt::format("Couldn't start playback (FMOD error {}).", static_cast<int>(r))); }
    m_channel->setVolume(playerVolume());
    if (startMs) m_channel->setPosition(startMs, FMOD_TIMEUNIT_MS);
    m_channel->setPaused(false);

    m_id = std::move(id);
    m_title = std::move(title);
    m_startMs = startMs;
    m_clipMs = clipMs;

    if (!m_pausedMenuMusic) {
        if (auto engine = FMODAudioEngine::sharedEngine(); engine && engine->m_backgroundMusicChannel) {
            engine->m_backgroundMusicChannel->setPaused(true);
            m_pausedMenuMusic = true;
        }
    }
    if (!m_scheduled) {
        CCDirector::sharedDirector()->getScheduler()->scheduleSelector(schedule_selector(Player::tick), this, 0.f, false);
        m_scheduled = true;
    }
    notify();
    return Ok();
}

bool Player::paused() const {
    bool p = false;
    if (m_channel) m_channel->getPaused(&p);
    return p;
}

void Player::togglePause() {
    if (!m_channel) return;
    m_channel->setPaused(!paused());
    notify();
}

void Player::stop() {
    bool had = m_channel || m_sound;
    freeSound();
    m_id.clear();
    m_title.clear();
    m_clipMs = 0;
    if (m_pausedMenuMusic) {
        if (auto engine = FMODAudioEngine::sharedEngine(); engine && engine->m_backgroundMusicChannel) {
            engine->m_backgroundMusicChannel->setPaused(false);
        }
        m_pausedMenuMusic = false;
    }
    if (m_scheduled) {
        CCDirector::sharedDirector()->getScheduler()->unscheduleSelector(schedule_selector(Player::tick), this);
        m_scheduled = false;
    }
    if (had) notify();
}

unsigned Player::positionMs() const {
    unsigned pos = 0;
    if (m_channel) m_channel->getPosition(&pos, FMOD_TIMEUNIT_MS);
    return pos;
}

float Player::progress() const {
    if (!m_channel) return 0.f;
    auto pos = positionMs();
    if (m_clipMs) return std::clamp((static_cast<float>(pos) - m_startMs) / m_clipMs, 0.f, 1.f);
    return m_lengthMs ? std::clamp(static_cast<float>(pos) / m_lengthMs, 0.f, 1.f) : 0.f;
}

void Player::tick(float) {
    if (!m_channel) { stop(); return; }
    bool playing = false;
    if (m_channel->isPlaying(&playing) != FMOD_OK || !playing) { m_channel = nullptr; stop(); return; }
    if (m_clipMs && !paused() && positionMs() >= m_startMs + m_clipMs) { stop(); return; }
    notify();
}

void Player::setListener(void* owner, std::function<void()> fn) {
    clearListener(owner);
    m_listeners.push_back({ owner, std::move(fn) });
}

void Player::clearListener(void* owner) {
    std::erase_if(m_listeners, [owner](auto const& l) { return l.first == owner; });
}

void Player::notify() {
    auto copy = m_listeners;   // listeners may add or remove themselves
    for (auto& l : copy) if (l.second) l.second();
}

unsigned audioLengthMs(std::filesystem::path const& file) {
    auto system = fmodSystem();
    if (!system) return 0;
    auto data = file::readBinary(file);
    if (!data || data.unwrap().empty()) return 0;
    auto bytes = std::move(data).unwrap();
    FMOD_CREATESOUNDEXINFO ex{};
    ex.cbsize = sizeof(ex);
    ex.length = static_cast<unsigned int>(bytes.size());
    FMOD::Sound* sound = nullptr;
    if (system->createSound(reinterpret_cast<char const*>(bytes.data()), FMOD_OPENMEMORY_POINT | FMOD_CREATESTREAM | FMOD_OPENONLY, &ex, &sound) != FMOD_OK || !sound) return 0;
    unsigned ms = 0;
    sound->getLength(&ms, FMOD_TIMEUNIT_MS);
    sound->release();
    return ms;
}

}
