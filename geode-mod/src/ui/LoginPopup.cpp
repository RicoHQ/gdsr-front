#include "LoginPopup.hpp"
#include "Theme.hpp"
#include "../Api.hpp"
#include "../Config.hpp"

using namespace geode::prelude;

namespace gdsr {

LoginPopup* LoginPopup::create(geode::Function<void()> onDone) {
    auto ret = new LoginPopup();
    if (ret->init(std::move(onDone))) {
        ret->autorelease();
        return ret;
    }
    delete ret;
    return nullptr;
}

bool LoginPopup::init(geode::Function<void()> onDone) {
    if (!Popup::init(300.f, 210.f, "panel.png"_spr)) return false;
    m_onDone = std::move(onDone);
    auto size = m_mainLayer->getContentSize();

    auto title = ui::label("Sign in to GDSR", "bigFont.fnt", .55f, ui::TEXT);
    title->setPosition(size.width / 2, size.height - 24.f);
    m_mainLayer->addChild(title);

    auto sub = ui::label("Use the same account as the website.", "chatFont.fnt", .7f, ui::MUTED);
    sub->setPosition(size.width / 2, size.height - 44.f);
    m_mainLayer->addChild(sub);

    m_email = TextInput::create(240.f, "Email", "chatFont.fnt");
    m_email->setCommonFilter(CommonFilter::Any);
    m_email->setMaxCharCount(120);
    m_email->setPosition(size.width / 2, size.height - 76.f);
    m_email->setString(session().email);
    m_mainLayer->addChild(m_email);

    m_password = TextInput::create(240.f, "Password", "chatFont.fnt");
    m_password->setCommonFilter(CommonFilter::Any);
    m_password->setPasswordMode(true);
    m_password->setMaxCharCount(128);
    m_password->setPosition(size.width / 2, size.height - 112.f);
    m_mainLayer->addChild(m_password);

    m_status = ui::label("", "chatFont.fnt", .65f, ui::MUTED);
    m_status->setPosition(size.width / 2, 62.f);
    m_mainLayer->addChild(m_status);

    m_submit = ui::button("Sign in", ui::Style::Primary, 116.f, 30.f, this, menu_selector(LoginPopup::onSubmit));
    m_submit->setPosition(size.width / 2 + 62.f, 32.f);
    m_buttonMenu->addChild(m_submit);

    auto signup = ui::button("Create account", ui::Style::Dark, 116.f, 30.f, this, menu_selector(LoginPopup::onSignUp), .38f);
    signup->setPosition(size.width / 2 - 62.f, 32.f);
    m_buttonMenu->addChild(signup);

    return true;
}

void LoginPopup::setStatus(std::string const& text, ccColor3B color) {
    m_status->setString(text.c_str());
    m_status->setColor(color);
    float max = m_mainLayer->getContentSize().width - 30.f;
    float w = m_status->getContentSize().width;
    m_status->setScale(w * .65f > max ? max / w : .65f);
}

void LoginPopup::onSignUp(CCObject*) {
    web::openLinkInBrowser(std::string(SITE_URL) + "#signup");
}

void LoginPopup::onSubmit(CCObject*) {
    if (m_busy) return;
    std::string email = m_email->getString();
    std::string password = m_password->getString();
    email = utils::string::trim(email);
    if (email.empty() || email.find('@') == std::string::npos) { setStatus("Enter your email.", ui::DANGER); return; }
    if (password.size() < 6) { setStatus("Enter your password.", ui::DANGER); return; }

    m_busy = true;
    ui::setEnabled(m_submit, false);
    setStatus("Signing in...", ui::MUTED);

    m_task.spawn(signIn(email, password), [this](Result<> result) {
        m_busy = false;
        ui::setEnabled(m_submit, true);
        if (!result) {
            setStatus(result.unwrapErr(), ui::DANGER);
            return;
        }
        Notification::create(fmt::format("Signed in as {}", displayName()), NotificationIcon::Success)->show();
        Ref<LoginPopup> self = this;
        queueInMainThread([self] {
            if (self->m_onDone) self->m_onDone();
            self->onClose(nullptr);
        });
    });
}

}
