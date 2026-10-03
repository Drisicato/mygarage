"""update_entry tells an omitted poi_category (keep it) from an explicit null
(clear it), which the Address Book page sends when it re-files a gas station
under another chip. Pydantic's model_fields_set is the discriminator (#108)."""

from app.schemas.address_book import AddressBookEntryUpdate


def test_omitted_poi_category_is_not_in_fields_set():
    upd = AddressBookEntryUpdate(business_name="Joe's Auto")
    assert "poi_category" not in upd.model_fields_set  # -> preserve existing


def test_explicit_null_poi_category_is_in_fields_set():
    upd = AddressBookEntryUpdate(poi_category=None)
    assert "poi_category" in upd.model_fields_set  # -> clear
    assert upd.poi_category is None


def test_explicit_value_sets_poi_category():
    upd = AddressBookEntryUpdate(poi_category="gas_station")
    assert "poi_category" in upd.model_fields_set
    assert upd.poi_category == "gas_station"
