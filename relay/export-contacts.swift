#!/usr/bin/env swift
// Bulk-export Contacts.app entries to JSON.
// Uses the native Contacts framework — ~100x faster than osascript/JXA
// for 1000+ contact databases.
//
// Usage: swift export-contacts.swift > contacts.json

import Contacts
import Foundation

let store = CNContactStore()

// Request access synchronously (will silently succeed if already granted)
let semaphore = DispatchSemaphore(value: 0)
var hasAccess = false
store.requestAccess(for: .contacts) { granted, _ in
    hasAccess = granted
    semaphore.signal()
}
semaphore.wait()

if !hasAccess {
    FileHandle.standardError.write("ERROR: Contacts access denied. Grant Privacy & Security → Contacts to the calling binary.\n".data(using: .utf8)!)
    exit(2)
}

let keys: [CNKeyDescriptor] = [
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactOrganizationNameKey as CNKeyDescriptor,
    CNContactNicknameKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
    CNContactEmailAddressesKey as CNKeyDescriptor,
]

func normalizePhone(_ s: String) -> String {
    return s.filter { ("0"..."9").contains($0) || $0 == "+" }
}

var rows: [[String: Any]] = []

let request = CNContactFetchRequest(keysToFetch: keys)
do {
    try store.enumerateContacts(with: request) { contact, _ in
        let first = contact.givenName
        let last = contact.familyName
        let org = contact.organizationName
        let nick = contact.nickname

        var name = ""
        if !first.isEmpty && !last.isEmpty { name = "\(first) \(last)" }
        else if !first.isEmpty { name = first }
        else if !last.isEmpty { name = last }
        else if !org.isEmpty { name = org }
        else if !nick.isEmpty { name = nick }

        if name.isEmpty { return }

        var phones: [String] = []
        for p in contact.phoneNumbers {
            let n = normalizePhone(p.value.stringValue)
            if !n.isEmpty { phones.append(n) }
        }

        var emails: [String] = []
        for e in contact.emailAddresses {
            let v = (e.value as String).lowercased()
            if !v.isEmpty { emails.append(v) }
        }

        if phones.isEmpty && emails.isEmpty { return }

        var row: [String: Any] = [
            "name": name,
            "phones": phones,
            "emails": emails,
        ]
        if !org.isEmpty { row["org"] = org }
        rows.append(row)
    }
} catch {
    FileHandle.standardError.write("ERROR: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(3)
}

let data = try JSONSerialization.data(withJSONObject: rows, options: [])
if let s = String(data: data, encoding: .utf8) {
    print(s)
}
FileHandle.standardError.write("exported \(rows.count) contacts\n".data(using: .utf8)!)
