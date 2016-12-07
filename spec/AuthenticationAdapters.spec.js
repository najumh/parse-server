var request = require('request');
var Config = require("../src/Config");
var defaultColumns = require('../src/Controllers/SchemaController').defaultColumns;
var authenticationLoader = require('../src/Adapters/Auth');
var path = require('path');

describe('AuthenticationProviers', function() {
  ["facebook", "github", "instagram", "google", "linkedin", "meetup", "twitter", "janrainengage", "janraincapture", "vkontakte"].map(function(providerName){
    it("Should validate structure of "+providerName, (done) => {
      var provider = require("../src/Adapters/Auth/"+providerName);
      jequal(typeof provider.validateAuthData, "function");
      jequal(typeof provider.validateAppId, "function");
      jequal(provider.validateAuthData({}, {}).constructor, Promise.prototype.constructor);
      jequal(provider.validateAppId("app", "key", {}).constructor, Promise.prototype.constructor);
      done();
    });
  });

  var getMockMyOauthProvider = function() {
    return {
      authData: {
        id: "12345",
        access_token: "12345",
        expiration_date: new Date().toJSON(),
      },
      shouldError: false,
      loggedOut: false,
      synchronizedUserId: null,
      synchronizedAuthToken: null,
      synchronizedExpiration: null,

      authenticate: function(options) {
        if (this.shouldError) {
          options.error(this, "An error occurred");
        } else if (this.shouldCancel) {
          options.error(this, null);
        } else {
          options.success(this, this.authData);
        }
      },
      restoreAuthentication: function(authData) {
        if (!authData) {
          this.synchronizedUserId = null;
          this.synchronizedAuthToken = null;
          this.synchronizedExpiration = null;
          return true;
        }
        this.synchronizedUserId = authData.id;
        this.synchronizedAuthToken = authData.access_token;
        this.synchronizedExpiration = authData.expiration_date;
        return true;
      },
      getAuthType: function() {
        return "myoauth";
      },
      deauthenticate: function() {
        this.loggedOut = true;
        this.restoreAuthentication(null);
      }
    };
  };

  Parse.User.extend({
    extended: function() {
      return true;
    }
  });

  var createOAuthUser = function(callback) {
    var jsonBody = {
      authData: {
        myoauth: getMockMyOauthProvider().authData
      }
    };

    var options = {
      headers: {'X-Parse-Application-Id': 'test',
        'X-Parse-REST-API-Key': 'rest',
        'X-Parse-Installation-Id': 'yolo',
        'Content-Type': 'application/json' },
      url: 'http://localhost:8378/1/users',
      body: JSON.stringify(jsonBody)
    };

    return request.post(options, callback);
  }

  it("should create user with REST API", done => {
    createOAuthUser((error, response, body) => {
      expect(error).toBe(null);
      var b = JSON.parse(body);
      ok(b.sessionToken);
      expect(b.objectId).not.toBeNull();
      expect(b.objectId).not.toBeUndefined();
      var sessionToken = b.sessionToken;
      var q = new Parse.Query("_Session");
      q.equalTo('sessionToken', sessionToken);
      q.first({useMasterKey: true}).then((res) => {
        if (!res) {
          fail('should not fail fetching the session');
          done();
          return;
        }
        expect(res.get("installationId")).toEqual('yolo');
        done();
      }).fail(() => {
        fail('should not fail fetching the session');
        done();
      })
    });
  });

  it("should only create a single user with REST API", (done) => {
    var objectId;
    createOAuthUser((error, response, body) => {
      expect(error).toBe(null);
      var b = JSON.parse(body);
      expect(b.objectId).not.toBeNull();
      expect(b.objectId).not.toBeUndefined();
      objectId = b.objectId;

      createOAuthUser((error, response, body) => {
        expect(error).toBe(null);
        var b = JSON.parse(body);
        expect(b.objectId).not.toBeNull();
        expect(b.objectId).not.toBeUndefined();
        expect(b.objectId).toBe(objectId);
        done();
      });
    });
  });

  it("unlink and link with custom provider", (done) => {
    var provider = getMockMyOauthProvider();
    Parse.User._registerAuthenticationProvider(provider);
    Parse.User._logInWith("myoauth", {
      success: function(model) {
        ok(model instanceof Parse.User, "Model should be a Parse.User");
        strictEqual(Parse.User.current(), model);
        ok(model.extended(), "Should have used the subclass.");
        strictEqual(provider.authData.id, provider.synchronizedUserId);
        strictEqual(provider.authData.access_token, provider.synchronizedAuthToken);
        strictEqual(provider.authData.expiration_date, provider.synchronizedExpiration);
        ok(model._isLinked("myoauth"), "User should be linked to myoauth");

        model._unlinkFrom("myoauth", {
          success: function(model) {

            ok(!model._isLinked("myoauth"),
               "User should not be linked to myoauth");
            ok(!provider.synchronizedUserId, "User id should be cleared");
            ok(!provider.synchronizedAuthToken, "Auth token should be cleared");
            ok(!provider.synchronizedExpiration,
               "Expiration should be cleared");
            // make sure the auth data is properly deleted
            var config = new Config(Parse.applicationId);
            config.database.adapter.find('_User', {
              fields: Object.assign({}, defaultColumns._Default, defaultColumns._Installation),
            }, { objectId: model.id }, {})
            .then(res => {
              expect(res.length).toBe(1);
              expect(res[0]._auth_data_myoauth).toBeUndefined();
              expect(res[0]._auth_data_myoauth).not.toBeNull();

              model._linkWith("myoauth", {
                success: function(model) {
                  ok(provider.synchronizedUserId, "User id should have a value");
                  ok(provider.synchronizedAuthToken,
                     "Auth token should have a value");
                  ok(provider.synchronizedExpiration,
                     "Expiration should have a value");
                  ok(model._isLinked("myoauth"),
                     "User should be linked to myoauth");
                  done();
                },
                error: function() {
                  ok(false, "linking again should succeed");
                  done();
                }
              });
            });
          },
          error: function() {
            ok(false, "unlinking should succeed");
            done();
          }
        });
      },
      error: function() {
        ok(false, "linking should have worked");
        done();
      }
    });
  });

  function validateValidator(validator) {
    expect(typeof validator).toBe('function');
  }

  function validateAuthenticationHandler(authenticatonHandler) {
    expect(authenticatonHandler).not.toBeUndefined();
    expect(typeof authenticatonHandler.getValidatorForProvider).toBe('function');
    expect(typeof authenticatonHandler.getValidatorForProvider).toBe('function');
  }

  it('properly loads custom adapter', (done) => {
    var validAuthData = {
      id: 'hello',
      token: 'world'
    }
    let adapter = {
      validateAppId: function() {
        return Promise.resolve();
      },
      validateAuthData: function(authData) {
        if (authData.id == validAuthData.id && authData.token == validAuthData.token) {
          return Promise.resolve();
        }
        return Promise.reject();
      }
    };

    let authDataSpy = spyOn(adapter, 'validateAuthData').and.callThrough();
    let appIdSpy = spyOn(adapter, 'validateAppId').and.callThrough();

    let authenticationHandler = authenticationLoader({
      customAuthentication: adapter
    });

    validateAuthenticationHandler(authenticationHandler);
    let validator = authenticationHandler.getValidatorForProvider('customAuthentication');
    validateValidator(validator);

    validator(validAuthData).then(() => {
      expect(authDataSpy).toHaveBeenCalled();
      // AppIds are not provided in the adapter, should not be called
      expect(appIdSpy).not.toHaveBeenCalled();
      done();
    }, (err) => {
      jfail(err);
      done();
    })
  });

  it('properly loads custom adapter module object', (done) => {
    let authenticationHandler = authenticationLoader({
      customAuthentication: path.resolve('./spec/support/CustomAuth.js')
    });

    validateAuthenticationHandler(authenticationHandler);
    let validator = authenticationHandler.getValidatorForProvider('customAuthentication');
    validateValidator(validator);

    validator({
      token: 'my-token'
    }).then(() => {
      done();
    }, (err) => {
      jfail(err);
      done();
    })
  });

  it('properly loads custom adapter module object', (done) => {
    let authenticationHandler = authenticationLoader({
      customAuthentication: { module: path.resolve('./spec/support/CustomAuthFunction.js'), options: { token: 'valid-token' }}
    });

    validateAuthenticationHandler(authenticationHandler);
    let validator = authenticationHandler.getValidatorForProvider('customAuthentication');
    validateValidator(validator);

    validator({
      token: 'valid-token'
    }).then(() => {
      done();
    }, (err) => {
      jfail(err);
      done();
    })
  });
});