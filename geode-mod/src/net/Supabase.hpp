#pragma once

#include <Geode/Geode.hpp>
#include <Geode/utils/web.hpp>
#include <Geode/utils/async.hpp>
#include <matjson.hpp>
#include <filesystem>

namespace gdsr {
    struct Session {
        std::string accessToken;
        std::string refreshToken;
        std::string userId;
        std::string email;
        std::string username;
        bool isAdmin = false;
        long long expiresAt = 0; // unix seconds
    };

    Session& session();
    bool signedIn();
    void signOut();
    void loadSavedSession();

    std::string displayName();

    using Json = matjson::Value;

    arc::Future<geode::Result<>> signIn(std::string email, std::string password);
    // refreshes the access token when it is close to expiring
    arc::Future<geode::Result<>> ensureSession();

    // PostgREST call. path is everything after /rest/v1/
    arc::Future<geode::Result<Json>> rest(std::string method, std::string path, std::optional<Json> body = std::nullopt, std::string prefer = "");

    // returns the object path (what songs.audio_file stores)
    arc::Future<geode::Result<std::string>> uploadAudio(std::string objectPath, geode::ByteVector data, std::string mime);

    arc::Future<geode::Result<>> downloadAudio(std::string objectPath, std::filesystem::path dest);

    std::string urlEncode(std::string_view s);
}
