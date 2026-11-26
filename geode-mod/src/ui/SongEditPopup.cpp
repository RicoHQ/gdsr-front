#include "SongEditPopup.hpp"
#include "Theme.hpp"
#include "../net/Gdsr.hpp"
#include "../net/Supabase.hpp"

#include <Geode/ui/Notification.hpp>
#include <cctype>

using namespace geode::prelude;

namespace gdsr {

static constexpr float W = 320.f;
static constexpr float H = 236.f;
static char const* const TYPES[] = { "original", "remix", "cover", "nong" };

SongEditPopup* SongEditPopup::create(std::string songId, std::function<void()> onSaved) {
    auto ret = new SongEditPopup();
    if (ret->init(std::move(songId), std::move(onSaved))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

TextInput* SongEditPopup::field(char const* title, float y, float x, float width, std::string const& value, char const* placeholder) {
    auto lbl = ui::label(title, "bigFont.fnt", .26f, ui::MUTED);
    lbl->setAnchorPoint({ 0.f, .5f });
    lbl->setPosition({ x, y + 15.f });
    m_mainLayer->addChild(lbl);
    auto input = TextInput::create(width, placeholder, "chatFont.fnt");
    input->setPosition({ x + width / 2, y });
    input->setString(value);
    m_mainLayer->addChild(input);
    return input;
}

bool SongEditPopup::init(std::string songId, std::function<void()> onSaved) {
    if (!Popup::init(W, H, "panel.png"_spr)) return false;
    m_songId = std::move(songId);
    m_onSaved = std::move(onSaved);
    auto s = catalog().byId(m_songId);
    if (!s) return false;
    m_type = s->type;

    auto title = ui::label("EDIT SONG", "bigFont.fnt", .4f, ui::TEXT);
    title->setPosition({ W / 2, H - 20.f });
    m_mainLayer->addChild(title);

    float full = W - 40.f, half = (full - 10.f) / 2;
    m_name = field("NAME", H - 58.f, 20.f, full, s->name, "Song name");
    m_name->setMaxCharCount(120);
    m_author = field("AUTHOR", H - 94.f, 20.f, full, s->author, "Artist (optional)");
    m_author->setMaxCharCount(120);
    m_gdId = field("SONG ID", H - 130.f, 20.f, half, s->songID ? std::to_string(s->songID) : "", "Newgrounds ID");
    m_gdId->setCommonFilter(CommonFilter::Uint);
    m_gdId->setMaxCharCount(10);
    m_length = field("LENGTH", H - 130.f, 30.f + half, half, s->length, "m:ss");
    m_length->setFilter("0123456789:");
    m_length->setMaxCharCount(6);

    auto typeLbl = ui::label("TYPE", "bigFont.fnt", .26f, ui::MUTED);
    typeLbl->setAnchorPoint({ 0.f, .5f });
    typeLbl->setPosition({ 20.f, H - 152.f });
    m_mainLayer->addChild(typeLbl);
    if (m_type == "mashup") {
        auto note = ui::label("Mashup (change its songs and type on the website)", "chatFont.fnt", .5f, ui::FAINT);
        note->setAnchorPoint({ 0.f, .5f });
        note->setPosition({ 20.f, H - 170.f });
        m_mainLayer->addChild(note);
    } else {
        float bw = (full - 3 * 6.f) / 4;
        for (int i = 0; i < 4; i++) {
            auto btn = ui::toggle(typeLabel(TYPES[i]), false, bw, 20.f, this, menu_selector(SongEditPopup::onType), .3f);
            btn->setTag(i);
            btn->setPosition({ 20.f + bw / 2 + i * (bw + 6.f), H - 170.f });
            m_buttonMenu->addChild(btn);
            m_typeBtns.push_back(btn);
        }
        refreshTypes();
    }

    m_status = ui::label("", "chatFont.fnt", .55f, ui::MUTED);
    m_status->setAnchorPoint({ 0.f, .5f });
    m_status->setPosition({ 20.f, 28.f });
    m_mainLayer->addChild(m_status);

    m_saveBtn = ui::button("Save", ui::Style::Primary, 80.f, 26.f, this, menu_selector(SongEditPopup::onSave), .4f);
    m_saveBtn->setPosition({ W - 20.f - 40.f, 30.f });
    m_buttonMenu->addChild(m_saveBtn);
    return true;
}

void SongEditPopup::refreshTypes() {
    float bw = (W - 40.f - 3 * 6.f) / 4;
    for (size_t i = 0; i < m_typeBtns.size(); i++) ui::setToggle(m_typeBtns[i], typeLabel(TYPES[i]), m_type == TYPES[i], bw, 20.f, .3f);
}

void SongEditPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float w = m_status->getContentSize().width;
    float max = W - 40.f - 90.f;
    m_status->setScale(w * .55f > max ? max / w : .55f);
}

void SongEditPopup::onType(CCObject* sender) {
    int i = static_cast<CCNode*>(sender)->getTag();
    if (i < 0 || i >= 4) return;
    m_type = TYPES[i];
    refreshTypes();
}

static std::string trim(std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    size_t a = 0;
    while (a < s.size() && std::isspace(static_cast<unsigned char>(s[a]))) a++;
    return s.substr(a);
}

static bool validLength(std::string const& s) {
    auto colon = s.find(':');
    if (colon == std::string::npos || colon == 0 || s.size() - colon - 1 != 2) return false;
    for (size_t i = 0; i < s.size(); i++) if (i != colon && !std::isdigit(static_cast<unsigned char>(s[i]))) return false;
    return s[colon + 1] <= '5';
}

static arc::Future<Result<>> saveSong(std::string id, Json row, long long gdId) {
    auto fresh = co_await ensureSession();
    if (!fresh) co_return Err(fresh.unwrapErr());
    if (!session().isAdmin) co_return Err("Only admins can edit songs.");
    if (gdId > 0) {
        auto ids = co_await rest("POST", "song_ids?on_conflict=song_id", matjson::makeObject({ {"song_id", static_cast<std::intmax_t>(gdId)} }), "resolution=ignore-duplicates,return=minimal");
        if (!ids) co_return Err("Song ID: " + ids.unwrapErr());
    }
    auto res = co_await rest("PATCH", "songs?id=eq." + id, row, "return=minimal");
    if (!res) co_return Err(res.unwrapErr());
    auto reload = co_await loadCatalog();
    (void)reload;
    co_return Ok();
}

void SongEditPopup::onSave(CCObject*) {
    if (m_busy) return;
    if (!signedIn() || !session().isAdmin) { setStatus("Sign in with an admin account first.", ui::DANGER); return; }
    auto name = trim(m_name->getString());
    auto author = trim(m_author->getString());
    auto idText = trim(m_gdId->getString());
    auto length = trim(m_length->getString());
    if (name.empty()) { setStatus("The song needs a name.", ui::DANGER); return; }
    if (!length.empty() && !validLength(length)) { setStatus("Write the length as m:ss, like 2:05.", ui::DANGER); return; }
    long long gdId = 0;
    if (!idText.empty()) {
        auto parsed = numFromString<long long>(idText);
        if (!parsed || parsed.unwrap() <= 0) { setStatus("The song ID must be a number.", ui::DANGER); return; }
        gdId = parsed.unwrap();
    }

    auto row = matjson::makeObject({
        {"name", name},
        {"author", author.empty() ? Json(nullptr) : Json(author)},
        {"song_id", gdId ? Json(static_cast<std::intmax_t>(gdId)) : Json(nullptr)},
        {"length", length.empty() ? Json(nullptr) : Json(length)},
    });
    if (m_type != "mashup") row["type"] = m_type;

    m_busy = true;
    ui::setEnabled(m_saveBtn, false);
    setStatus("Saving...", ui::MUTED);
    m_task.spawn(saveSong(m_songId, std::move(row), gdId), [this](Result<> res) {
        m_busy = false;
        ui::setEnabled(m_saveBtn, true);
        if (!res) { setStatus(res.unwrapErr(), ui::DANGER); return; }
        Notification::create("Song saved", NotificationIcon::Success)->show();
        // closed on the next frame, so this popup isn't freed while its own task is still finishing
        Loader::get()->queueInMainThread([self = Ref<SongEditPopup>(this), done = m_onSaved] {
            self->onClose(nullptr);
            if (done) done();
        });
    });
}

}
