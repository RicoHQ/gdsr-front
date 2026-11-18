#include "Supabase.hpp"
#include "../Config.hpp"

#include <ctime>
#include <cctype>

using namespace geode::prelude;

namespace gdsr {

static Session g_session;

Session& session() { return g_session; }
bool signedIn() { return !g_session.userId.empty() && !g_session.refreshToken.empty(); }

static long long now() { return static_cast<long long>(std::time(nullptr)); }

void loadSavedSession() {
    g_session.refreshToken = Mod::get()->getSavedValue<std::string>("refresh-token", "");
    g_session.userId = Mod::get()->getSavedValue<std::string>("user-id", "");
    g_session.email = Mod::get()->getSavedValue<std::string>("email", "");
    g_session.username = Mod::get()->getSavedValue<std::string>("username", "");
    g_session.isAdmin = Mod::get()->getSavedValue<bool>("is-admin", false);
}

static void saveSession() {
    Mod::get()->setSavedValue<std::string>("refresh-token", g_session.refreshToken);
    Mod::get()->setSavedValue<std::string>("user-id", g_session.userId);
    Mod::get()->setSavedValue<std::string>("email", g_session.email);
    Mod::get()->setSavedValue<std::string>("username", g_session.username);
    Mod::get()->setSavedValue<bool>("is-admin", g_session.isAdmin);
}

void signOut() {
    g_session = Session{};
    saveSession();
}

std::string displayName() {
    if (!g_session.username.empty()) return g_session.username;
    if (!g_session.email.empty()) return g_session.email;
    return "your account";
}

std::string urlEncode(std::string_view s) {
    static char const* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += static_cast<char>(c);
        else { out += '%'; out += hex[c >> 4]; out += hex[c & 15]; }
    }
    return out;
}

static std::string errorText(web::WebResponse const& res) {
    auto body = res.string().unwrapOr("");
    if (auto json = matjson::parse(body); json.isOk()) {
        auto v = json.unwrap();
        for (auto key : {"error_description", "message", "msg", "error"}) {
            if (v.contains(key) && v[key].isString()) {
                auto text = v[key].asString().unwrap();
                if (text == "Invalid login credentials") return "Wrong email or password.";
                if (text.find("Email not confirmed") != std::string::npos) return "Confirm your email first (check your inbox).";
                if (text.find("duplicate key") != std::string::npos) return "That's already on GDSR or already requested.";
                if (text.find("row-level security") != std::string::npos) return "Your account isn't allowed to do that.";
                return text;
            }
        }
    }
    if (res.code() == 0 || res.code() < 0) {
        auto err = std::string(res.errorMessage());
        return err.empty() ? "Couldn't reach GDSR. Check your internet connection." : err;
    }
    if (body.size() > 160) body = body.substr(0, 157) + "...";
    return fmt::format("Request failed ({}) {}", res.code(), body);
}

static web::WebRequest request(bool auth) {
    web::WebRequest req;
    req.header("apikey", SUPABASE_KEY);
    req.header("Accept", "application/json");
    if (auth && !g_session.accessToken.empty()) {
        req.header("Authorization", "Bearer " + g_session.accessToken);
    } else {
        req.header("Authorization", std::string("Bearer ") + SUPABASE_KEY);
    }
    req.timeout(std::chrono::seconds(60));
    return req;
}

static Result<> applyAuthResponse(Json const& v) {
    auto access = v["access_token"].asString();
    auto refresh = v["refresh_token"].asString();
    if (!access || !refresh) return Err("Unexpected sign-in response.");
    g_session.accessToken = access.unwrap();
    g_session.refreshToken = refresh.unwrap();
    g_session.expiresAt = now() + v["expires_in"].asInt().unwrapOr(3600);
    if (v.contains("user")) {
        g_session.userId = v["user"]["id"].asString().unwrapOr(g_session.userId);
        g_session.email = v["user"]["email"].asString().unwrapOr(g_session.email);
    }
    return Ok();
}

static arc::Future<Result<>> loadProfile() {
    // has_role RPC first (like the site), user_roles as a fallback
    {
        auto req = request(true);
        req.header("Content-Type", "application/json");
        req.bodyJSON(matjson::makeObject({ {"_user_id", g_session.userId}, {"_role", "admin"} }));
        auto res = co_await req.post(fmt::format("{}/rest/v1/rpc/has_role", SUPABASE_URL));
        if (res.ok()) {
            auto v = res.json().unwrapOr(Json(false));
            g_session.isAdmin = v.asBool().unwrapOr(false);
        } else {
            auto req2 = request(true);
            auto res2 = co_await req2.get(fmt::format("{}/rest/v1/user_roles?select=role&user_id=eq.{}", SUPABASE_URL, g_session.userId));
            g_session.isAdmin = false;
            if (res2.ok()) {
                auto arr = res2.json().unwrapOr(Json::array());
                if (arr.isArray()) {
                    for (auto& row : arr) {
                        if (row["role"].asString().unwrapOr("") == "admin") g_session.isAdmin = true;
                    }
                }
            }
        }
    }
    {
        auto req = request(true);
        auto res = co_await req.get(fmt::format("{}/rest/v1/profiles?select=username&id=eq.{}", SUPABASE_URL, g_session.userId));
        if (res.ok()) {
            auto arr = res.json().unwrapOr(Json::array());
            if (arr.isArray() && arr.size() > 0) {
                g_session.username = arr[0]["username"].asString().unwrapOr(g_session.username);
            }
        }
    }
    saveSession();
    co_return Ok();
}

arc::Future<Result<>> signIn(std::string email, std::string password) {
    auto req = request(false);
    req.header("Content-Type", "application/json");
    req.bodyJSON(matjson::makeObject({ {"email", email}, {"password", password} }));
    auto res = co_await req.post(fmt::format("{}/auth/v1/token?grant_type=password", SUPABASE_URL));
    if (!res.ok()) co_return Err(errorText(res));
    auto json = res.json();
    if (!json) co_return Err("Unexpected sign-in response.");
    auto applied = applyAuthResponse(json.unwrap());
    if (!applied) co_return Err(applied.unwrapErr());
    saveSession();
    (void)co_await loadProfile();
    co_return Ok();
}

arc::Future<Result<>> ensureSession() {
    if (g_session.refreshToken.empty()) co_return Err("Sign in first.");
    if (!g_session.accessToken.empty() && g_session.expiresAt - now() > 120) co_return Ok();

    auto req = request(false);
    req.header("Content-Type", "application/json");
    req.bodyJSON(matjson::makeObject({ {"refresh_token", g_session.refreshToken} }));
    auto res = co_await req.post(fmt::format("{}/auth/v1/token?grant_type=refresh_token", SUPABASE_URL));
    if (!res.ok()) {
        if (res.code() == 400 || res.code() == 401) {
            signOut();
            co_return Err("Your sign-in expired. Please sign in again.");
        }
        co_return Err(errorText(res));
    }
    auto json = res.json();
    if (!json) co_return Err("Unexpected sign-in response.");
    auto applied = applyAuthResponse(json.unwrap());
    if (!applied) co_return Err(applied.unwrapErr());
    saveSession();
    (void)co_await loadProfile();
    co_return Ok();
}

arc::Future<Result<Json>> rest(std::string method, std::string path, std::optional<Json> body, std::string prefer) {
    auto req = request(true);
    if (body) {
        req.header("Content-Type", "application/json");
        req.bodyJSON(*body);
    }
    if (!prefer.empty()) req.header("Prefer", prefer);
    auto res = co_await req.send(method, fmt::format("{}/rest/v1/{}", SUPABASE_URL, path));
    if (!res.ok()) co_return Err(errorText(res));
    auto text = res.string().unwrapOr("");
    if (text.empty()) co_return Ok(Json());
    auto json = matjson::parse(text);
    if (!json) co_return Ok(Json());
    co_return Ok(json.unwrap());
}

arc::Future<Result<std::string>> uploadAudio(std::string objectPath, ByteVector data, std::string mime) {
    auto req = request(true);
    req.header("Content-Type", mime);
    req.header("x-upsert", "false");
    req.header("cache-control", "3600");
    req.body(std::move(data));
    req.timeout(std::chrono::seconds(300));
    auto res = co_await req.post(fmt::format("{}/storage/v1/object/{}/{}", SUPABASE_URL, AUDIO_BUCKET, objectPath));
    if (!res.ok()) {
        auto msg = errorText(res);
        if (msg.find("row-level security") != std::string::npos || msg.find("allowed to do that") != std::string::npos) {
            msg = "The audio storage refused the upload. Ask an admin to check the storage rules.";
        }
        co_return Err(msg);
    }
    co_return Ok(objectPath);
}

static std::string encodePath(std::string const& path) {
    std::string out;
    size_t start = 0;
    while (true) {
        auto slash = path.find('/', start);
        out += urlEncode(path.substr(start, slash == std::string::npos ? std::string::npos : slash - start));
        if (slash == std::string::npos) break;
        out += '/';
        start = slash + 1;
    }
    return out;
}

arc::Future<Result<>> downloadAudio(std::string objectPath, std::filesystem::path dest) {
    if (signedIn()) (void)co_await ensureSession();
    auto req = request(true);
    req.header("Content-Type", "application/json");
    req.bodyJSON(matjson::makeObject({ {"expiresIn", 3600} }));
    auto res = co_await req.post(fmt::format("{}/storage/v1/object/sign/{}/{}", SUPABASE_URL, AUDIO_BUCKET, encodePath(objectPath)));
    if (!res.ok()) co_return Err(errorText(res));
    auto json = res.json();
    if (!json) co_return Err("Unexpected storage response.");
    auto signedUrl = json.unwrap()["signedURL"].asString().unwrapOr("");
    if (signedUrl.empty()) co_return Err("The audio file couldn't be signed.");
    if (signedUrl.rfind("http", 0) != 0) signedUrl = fmt::format("{}/storage/v1{}", SUPABASE_URL, signedUrl);

    web::WebRequest get;
    get.timeout(std::chrono::seconds(180));
    auto file = co_await get.get(signedUrl);
    if (!file.ok()) co_return Err(errorText(file));
    std::error_code ec;
    std::filesystem::create_directories(dest.parent_path(), ec);
    auto saved = file.into(dest);
    if (!saved) co_return Err("Couldn't save the audio: " + saved.unwrapErr());
    co_return Ok();
}

}
