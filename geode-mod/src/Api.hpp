#pragma once

#include <Geode/Geode.hpp>
#include <Geode/utils/web.hpp>
#include <Geode/utils/async.hpp>
#include <matjson.hpp>

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
    // restores the saved refresh token (if any) so a session can be refreshed later
    void loadSavedSession();

    std::string displayName();

    using Json = matjson::Value;

    arc::Future<geode::Result<>> signIn(std::string email, std::string password);
    // refreshes the access token if it is about to expire and loads role and username
    arc::Future<geode::Result<>> ensureSession();

    // PostgREST call. path is everything after /rest/v1/
    arc::Future<geode::Result<Json>> rest(std::string method, std::string path, std::optional<Json> body = std::nullopt, std::string prefer = "");

    // uploads to the private audio bucket, returns the object path that the site stores in audio_file
    arc::Future<geode::Result<std::string>> uploadAudio(std::string objectPath, geode::ByteVector data, std::string mime);

    std::string urlEncode(std::string_view s);
}
