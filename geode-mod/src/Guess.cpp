#include "Guess.hpp"

#include <set>

using namespace geode::prelude;

namespace gdsr {

static std::vector<std::string> splitList(std::string const& s) {
    std::vector<std::string> out;
    for (auto& part : utils::string::split(s, ",")) {
        auto p = utils::string::trim(part);
        if (!p.empty()) out.push_back(p);
    }
    return out;
}

static std::string joinList(std::vector<std::string> const& v) {
    std::string out;
    for (auto const& x : v) { if (!out.empty()) out += ","; out += x; }
    return out;
}

GuessConfig GuessConfig::load() {
    GuessConfig c;
    auto mod = Mod::get();
    auto types = mod->getSavedValue<std::string>("guess-types", "original,mashup,cover,remix,nong");
    c.types = splitList(types);
    if (c.types.empty()) c.types = { "original", "mashup", "cover", "remix", "nong" };
    c.randomStart = mod->getSavedValue<bool>("guess-random", false);
    c.diffs = splitList(mod->getSavedValue<std::string>("guess-diffs", ""));
    c.level = std::clamp(static_cast<int>(mod->getSavedValue<int64_t>("guess-level", 1)), 0, GUESS_LEVEL_COUNT - 1);
    c.rounds = static_cast<int>(mod->getSavedValue<int64_t>("guess-rounds", 10));
    if (c.rounds != 5 && c.rounds != 10 && c.rounds != 15 && c.rounds != 20) c.rounds = 10;
    return c;
}

void GuessConfig::save() const {
    auto mod = Mod::get();
    mod->setSavedValue<std::string>("guess-types", joinList(types));
    mod->setSavedValue<bool>("guess-random", randomStart);
    mod->setSavedValue<std::string>("guess-diffs", joinList(diffs));
    mod->setSavedValue<int64_t>("guess-level", level);
    mod->setSavedValue<int64_t>("guess-rounds", rounds);
}

std::string GuessConfig::bestKey() const {
    return fmt::format("guess-best-{}-{}", gameLevel().key, randomStart ? "random" : "start");
}

std::vector<Song const*> guessPool(GuessConfig const& cfg) {
    std::set<long long> ids;
    if (!cfg.diffs.empty()) {
        for (auto const& l : catalog().levels) {
            if (l.songID && std::find(cfg.diffs.begin(), cfg.diffs.end(), l.difficulty) != cfg.diffs.end()) ids.insert(l.songID);
        }
    }
    std::vector<Song const*> out;
    for (auto const& s : catalog().songs) {
        if (s.audioFile.empty()) continue;
        if (std::find(cfg.types.begin(), cfg.types.end(), s.type) == cfg.types.end()) continue;
        if (!cfg.diffs.empty() && !ids.contains(s.songID)) continue;
        out.push_back(&s);
    }
    return out;
}

std::string clipText(float seconds) {
    if (seconds < 1.f) return fmt::format("{}ms", static_cast<int>(seconds * 1000));
    return fmt::format("{}s", static_cast<int>(seconds));
}

}
