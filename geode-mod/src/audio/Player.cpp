#include "Player.hpp"

#include <Geode/binding/FMODAudioEngine.hpp>
#include <Geode/utils/file.hpp>
#include <fmod.hpp>
#include "AudioSniff.hpp"

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

static char const* fmodErrName(FMOD_RESULT r) {
    switch (static_cast<int>(r)) {
        case 13: return "bad file";
        case 16: case 17: return "file ended early";
        case 18: return "file not found";
        case 19: return "unsupported format";
        case 20: return "header mismatch";
        case 31: return "invalid parameter";
        case 38: return "out of memory";
        default: return "error";
    }
}

static std::string fmodErr(FMOD_RESULT r) {
    return fmt::format("{} {}", fmodErrName(r), static_cast<int>(r));
}

static std::string narrowPath(std::filesystem::path const& p) {
#ifdef GEODE_IS_WINDOWS
    auto u8 = p.u8string();
    return std::string(reinterpret_cast<char const*>(u8.data()), u8.size());
#else
    return p.string();
#endif
}

// Opens a sound straight from its file, the way the game opens songs.
// Falls back to reading it into memory if FMOD can't open the path.
static FMOD_RESULT openSound(FMOD::System* system, std::filesystem::path const& file, FMOD_MODE mode, FMOD::Sound** out, geode::ByteVector& keep) {
    *out = nullptr;
    auto r = system->createSound(narrowPath(file).c_str(), mode, nullptr, out);
    if (r == FMOD_OK && *out) return r;
#ifdef GEODE_IS_WINDOWS
    // some FMOD builds read the path in the system code page
    if (auto r2 = system->createSound(file.string().c_str(), mode, nullptr, out); r2 == FMOD_OK && *out) return r2;
#endif
    log::warn("GDSR player: opening {} from disk failed ({}), trying memory", file.filename().string(), fmodErr(r));
    auto data = file::readBinary(file);
    if (!data || data.unwrap().empty()) return r;
    keep = std::move(data).unwrap();
    FMOD_CREATESOUNDEXINFO ex{};
    ex.cbsize = sizeof(ex);
    ex.length = static_cast<unsigned int>(keep.size());
    auto r3 = system->createSound(reinterpret_cast<char const*>(keep.data()), mode | FMOD_OPENMEMORY_POINT, &ex, out);
    if (r3 != FMOD_OK || !*out) { *out = nullptr; keep.clear(); }
    return r3;
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
    std::error_code ec;
    if (!std::filesystem::exists(file, ec)) return Err("The audio file is missing.");

    freeSound();
    auto r = openSound(system, file, FMOD_CREATESTREAM | FMOD_2D, &m_sound, m_data);
    if (r != FMOD_OK || !m_sound) {
        log::warn("GDSR player: createSound failed for {} ({})", file.filename().string(), fmodErr(r));
        m_sound = nullptr;
        // a bad cached copy gets downloaded again next time
        if (!audioExtOfFile(file)) std::filesystem::remove(file, ec);
        return Err(fmt::format("This audio can't be played ({}).", fmodErr(r)));
    }

    m_lengthMs = 0;
    m_sound->getLength(&m_lengthMs, FMOD_TIMEUNIT_MS);
    if (m_lengthMs && startMs >= m_lengthMs) startMs = 0;

    r = system->playSound(m_sound, nullptr, true, &m_channel);
    if (r != FMOD_OK || !m_channel) { log::warn("GDSR player: playSound failed ({})", fmodErr(r)); freeSound(); return Err(fmt::format("Couldn't start playback ({}).", fmodErr(r))); }
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
    FMOD::Sound* sound = nullptr;
    geode::ByteVector keep;
    if (openSound(system, file, FMOD_CREATESTREAM | FMOD_OPENONLY, &sound, keep) != FMOD_OK || !sound) return 0;
    unsigned ms = 0;
    sound->getLength(&ms, FMOD_TIMEUNIT_MS);
    sound->release();
    return ms;
}

}
