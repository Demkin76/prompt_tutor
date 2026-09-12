import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { env } from "./_generated/server";

const password = Password({
  profile(params) {
    const email = params.email;
    if (typeof email !== "string" || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

    if (params.flow === "signUp") {
      const expected = env.ADMIN_REGISTRATION_SECRET;
      if (
        !expected ||
        typeof params.registrationSecret !== "string" ||
        params.registrationSecret !== expected
      ) {
        throw new Error("Public sign-up is disabled");
      }
    }

    return { email: email.trim().toLowerCase() };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [password],
});
